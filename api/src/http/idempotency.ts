import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors.js";
import type { Store } from "../store/store.js";
import { partnerOf } from "./auth.js";

/**
 * Idempotency-Key handling for money-moving POSTs (docs/openapi.yaml):
 * - same key + same body  → the original response is replayed, nothing runs twice
 * - same key + other body → 409 idempotency_conflict
 * - same key while the first request is still running → 409 idempotency_conflict
 * 5xx responses are not remembered, so the client can retry them.
 */
export function idempotent(store: Store) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.header("idempotency-key");
    if (!key || key.length < 8 || key.length > 128) {
      next(
        new ApiError(400, "invalid_request", "Idempotency-Key header (8–128 chars) is required"),
      );
      return;
    }

    const scope = `${partnerOf(res).slug}:${req.method}:${req.path}:${key}`;
    const requestHash = createHash("sha256")
      .update(JSON.stringify(req.body ?? null))
      .digest("hex");
    const existing = store.getIdempotency(scope);

    if (existing) {
      if (existing.requestHash !== requestHash) {
        next(
          new ApiError(
            409,
            "idempotency_conflict",
            "This Idempotency-Key was already used with a different request body",
          ),
        );
      } else if (existing.inProgress) {
        next(new ApiError(409, "idempotency_conflict", "A request with this key is still running"));
      } else {
        res.setHeader("Idempotent-Replayed", "true");
        res.status(existing.status ?? 200).json(existing.body);
      }
      return;
    }

    store.saveIdempotency(scope, {
      requestHash,
      inProgress: true,
      createdAt: new Date().toISOString(),
    });

    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode >= 500) {
        store.deleteIdempotency(scope);
      } else {
        store.saveIdempotency(scope, {
          requestHash,
          inProgress: false,
          status: res.statusCode,
          body,
          createdAt: new Date().toISOString(),
        });
      }
      return json(body);
    };
    next();
  };
}
