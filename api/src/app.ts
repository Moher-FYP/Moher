import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { AppContext } from "./context.js";
import { MoneyFormatError } from "./domain/money.js";
import { QuoteTooSmallError } from "./domain/pricing.js";
import { ApiError, sendError } from "./errors.js";
import { partnerRoutes } from "./http/routes.js";

export function createApp(ctx: AppContext): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.use(partnerRoutes(ctx));

  app.use((req, res) => {
    sendError(res, 404, "not_found", `No route for ${req.method} ${req.originalUrl}`);
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      sendError(res, err.status, err.code, err.message, err.details);
    } else if (err instanceof SyntaxError) {
      sendError(res, 400, "invalid_request", "Request body is not valid JSON");
    } else if (err instanceof MoneyFormatError || err instanceof QuoteTooSmallError) {
      sendError(res, 400, "invalid_request", err.message);
    } else {
      console.error(err);
      sendError(res, 500, "internal_error", "Unexpected error");
    }
  });

  return app;
}
