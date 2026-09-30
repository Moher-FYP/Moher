import { createHmac, timingSafeEqual } from "node:crypto";
import { MoharWebhookError } from "./errors.js";
import type { TransactionEvent } from "./types.js";

export const WEBHOOK_SIGNATURE_HEADER = "mohar-signature";
const DEFAULT_TOLERANCE_SECONDS = 300;

/** HMAC-SHA256 over `"<timestamp>.<payload>"`, hex encoded. Used by both the API and the SDK. */
export function computeWebhookSignature(
  payload: string,
  secret: string,
  timestamp: number,
): string {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
}

/** Builds the `Mohar-Signature` header value: `t=<unix seconds>,v1=<hex hmac>`. */
export function buildWebhookSignatureHeader(
  payload: string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestamp},v1=${computeWebhookSignature(payload, secret, timestamp)}`;
}

export interface VerifyWebhookOptions {
  /** The raw request body exactly as received — do not re-serialise parsed JSON. */
  payload: string | Buffer;
  /** Value of the `Mohar-Signature` header. */
  header: string | null | undefined;
  /** Your webhook signing secret from MOHAR. */
  secret: string;
  /** Reject events older than this. Default 300 seconds. */
  toleranceSeconds?: number;
  /** Override the clock (unix seconds), for tests. */
  now?: number;
}

/**
 * Verifies a MOHAR webhook and returns the parsed event.
 * @throws MoharWebhookError if the signature is missing, malformed, wrong or too old.
 */
export function verifyWebhookSignature(options: VerifyWebhookOptions): TransactionEvent {
  const { header, secret } = options;
  const payload =
    typeof options.payload === "string" ? options.payload : options.payload.toString("utf8");
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options.now ?? Math.floor(Date.now() / 1000);

  if (!header) throw new MoharWebhookError("Missing Mohar-Signature header");

  const parts = new Map<string, string>();
  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key && value) parts.set(key, value);
  }
  const timestamp = Number(parts.get("t"));
  const signature = parts.get("v1");
  if (!Number.isInteger(timestamp) || !signature) {
    throw new MoharWebhookError("Malformed Mohar-Signature header");
  }
  if (Math.abs(now - timestamp) > tolerance) {
    throw new MoharWebhookError("Webhook timestamp outside tolerance");
  }

  const expected = Buffer.from(computeWebhookSignature(payload, secret, timestamp), "hex");
  const received = Buffer.from(signature, "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new MoharWebhookError("Invalid webhook signature");
  }

  try {
    return JSON.parse(payload) as TransactionEvent;
  } catch {
    throw new MoharWebhookError("Webhook payload is not valid JSON");
  }
}
