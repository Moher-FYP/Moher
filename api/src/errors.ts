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

export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): void {
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}
