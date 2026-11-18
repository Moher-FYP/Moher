import type { NextRequest } from "next/server";

/**
 * Passes the browser's /portal/v1/* requests to the MOHAR API, so the browser only ever talks
 * to the portal's own origin: the API's session cookie (Path=/portal, SameSite=Strict) and its
 * Origin check work unchanged, and the API itself stays on 127.0.0.1.
 *
 * A route rather than a next.config rewrite because rewrites are fixed when the app is built;
 * this reads MOHAR_API_URL on every request. Only the headers the API needs go through, the
 * destination is always the API (a request cannot be pointed elsewhere), and redirects are not
 * followed.
 */

const REQUEST_HEADERS = ["accept", "content-type", "cookie", "origin", "user-agent"];
const RESPONSE_HEADERS = ["content-type", "content-disposition", "retry-after", "cache-control"];

function apiBase(): string {
  return process.env.MOHAR_API_URL ?? "http://127.0.0.1:4000";
}

async function pass(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (path.some((segment) => segment === "." || segment === ".." || segment === "")) {
    return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
  }
  const url = new URL(`/portal/v1/${path.map(encodeURIComponent).join("/")}`, apiBase());
  url.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // The person's address, for the API's per-address sign-in limit and its logs (TRUST_PROXY).
  // Next.js sets X-Forwarded-For to the connecting address only when the request has none, so
  // a client reaching the portal directly could supply its own. Only the right-most entry is
  // passed on: behind one reverse proxy that appends the real address (as nginx and most load
  // balancers do), that entry is the one the proxy saw. In production the portal must sit
  // behind such a proxy; the per-account slow-down and lock do not depend on it.
  const client = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (client) headers.set("x-forwarded-for", client);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { error: { code: "internal_error", message: "The MOHAR API is not reachable" } },
      { status: 502 },
    );
  }

  const out = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
  return new Response(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    headers: out,
  });
}

export { pass as GET, pass as POST, pass as PUT, pass as DELETE };
