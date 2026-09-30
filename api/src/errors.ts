import type { Response } from "express";

/** Error codes from docs/openapi.yaml (components.schemas.Error). */
export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "not_found"
  | "quote_expired"
  | "price_moved"
  | "wallet_frozen"
  | "wallet_not_registered"
  | "minting_paused"
  | "insufficient_balance"
  | "idempotency_conflict"
  | "not_implemented"
  | "internal_error";

/** Throw from a route handler; the error middleware turns it into the spec's error shape. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): void {
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}
