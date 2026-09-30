import type { ErrorCode } from "./types.js";

/** Error returned by the MOHAR API (non-2xx response). */
export class MoharApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | "unknown";
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: number,
    code: ErrorCode | "unknown",
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "MoharApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** The request did not complete in time, or a transaction did not settle in time. */
export class MoharTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoharTimeoutError";
  }
}

/** A webhook failed signature or timestamp verification. Respond 400 and ignore it. */
export class MoharWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoharWebhookError";
  }
}
