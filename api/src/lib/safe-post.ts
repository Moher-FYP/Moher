import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

/**
 * Posts webhooks without letting a partner point MOHAR's server at its own network (server-side
 * request forgery). Follows OWASP's SSRF Prevention Cheat Sheet for URLs that must reach
 * arbitrary external hosts:
 * - https only (plain http only to this machine, and only when allowed, for the local demo);
 * - every address the host resolves to must be public: no loopback, private, link-local
 *   (169.254.x.x, where cloud metadata lives), unique-local, multicast or reserved ranges, with
 *   IPv4-mapped and NAT64 IPv6 forms unwrapped first;
 * - the check runs inside the connection's own DNS lookup, so the address checked is the
 *   address connected to (no gap for DNS rebinding);
 * - redirects are not followed, and each attempt times out.
 */

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv6");
}

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) addresses hide an IPv4 address. */
function unwrap(address: string): { address: string; family: "ipv4" | "ipv6" } {
  const lower = address.toLowerCase();
  for (const prefix of ["::ffff:", "64:ff9b::"]) {
    if (lower.startsWith(prefix)) {
      const rest = lower.slice(prefix.length);
      if (isIP(rest) === 4) return { address: rest, family: "ipv4" };
      const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
      if (hex) {
        const n = (parseInt(hex[1]!, 16) << 16) | parseInt(hex[2]!, 16);
        const v4 = [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
        return { address: v4, family: "ipv4" };
      }
    }
  }
  return { address, family: isIP(address) === 6 ? "ipv6" : "ipv4" };
}

function isLoopback(address: string): boolean {
  const { address: plain, family } = unwrap(address);
  return LOOPBACK.check(plain, family);
}

/** True if MOHAR may connect to this IP address. */
export function isAllowedAddress(address: string, allowLoopback: boolean): boolean {
  const { address: plain, family } = unwrap(address);
  if (allowLoopback && LOOPBACK.check(plain, family)) return true;
  return !BLOCKED.check(plain, family);
}

/**
 * Checks a webhook URL's form before it is saved: https, no credentials, a real host name or a
 * public IP. The addresses it resolves to are checked again on every delivery.
 */
export function checkWebhookUrl(raw: string, allowLoopback: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Not a valid URL");
  }
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  const loopbackHost = url.hostname === "localhost" || (isIP(literal) !== 0 && isLoopback(literal));
  if (url.protocol !== "https:" && !(url.protocol === "http:" && allowLoopback && loopbackHost)) {
    throw new UnsafeUrlError("Use an https:// URL");
  }
  if (url.username || url.password) throw new UnsafeUrlError("Do not put credentials in the URL");
  if (url.hostname === "localhost" && !allowLoopback) {
    throw new UnsafeUrlError("The URL must reach a public address");
  }
  if (isIP(literal) && !isAllowedAddress(literal, allowLoopback)) {
    throw new UnsafeUrlError("The URL must reach a public address");
  }
  return url;
}

export interface PostResult {
  status: number;
}

export type Transport = (
  url: string,
  headers: Record<string, string>,
  body: string,
) => Promise<PostResult>;

type LookupFn = typeof dnsLookup;

/**
 * Builds the transport the webhook sender uses. `resolve` is injectable for tests.
 */
export function safeTransport(options: {
  allowLoopback: boolean;
  timeoutMs?: number;
  resolve?: LookupFn;
}): Transport {
  const resolve = options.resolve ?? dnsLookup;
  const timeoutMs = options.timeoutMs ?? 15_000;

  // Called by node for the connection itself: what it returns is what it connects to.
  const guardedLookup = ((hostname: string, lookupOptions: object, callback: Function) => {
    resolve(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
      if (error) return callback(error);
      const list = addresses as unknown as LookupAddress[];
      const bad = list.find((a) => !isAllowedAddress(a.address, options.allowLoopback));
      if (bad || list.length === 0) {
        return callback(
          new UnsafeUrlError(`${hostname} resolves to an address MOHAR will not call`),
        );
      }
      if ((lookupOptions as { all?: boolean }).all) return callback(null, list);
      return callback(null, list[0]!.address, list[0]!.family);
    });
  }) as unknown as LookupFn;

  return (raw, headers, body) =>
    new Promise<PostResult>((resolvePost, reject) => {
      let url: URL;
      try {
        url = checkWebhookUrl(raw, options.allowLoopback);
      } catch (error) {
        reject(error);
        return;
      }
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = send(
        url,
        {
          method: "POST",
          headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() },
          lookup: guardedLookup,
          timeout: timeoutMs,
        },
        (res) => {
          res.resume(); // read and discard the body; redirects are not followed
          res.on("end", () => resolvePost({ status: res.statusCode ?? 0 }));
        },
      );
      req.on("timeout", () => req.destroy(new Error(`No response within ${timeoutMs} ms`)));
      req.on("error", reject);
      req.end(body);
    });
}
