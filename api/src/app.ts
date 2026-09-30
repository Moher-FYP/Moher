import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { sendError } from "./errors.js";

/** What the app needs from the blockchain. Real implementation uses viem; tests pass a fake. */
export interface ChainStatus {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
}

export interface AppDeps {
  chain: ChainStatus;
}

export function createApp({ chain }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.get("/v1/health", async (_req, res) => {
    try {
      const [chainId, blockNumber] = await Promise.all([
        chain.getChainId(),
        chain.getBlockNumber(),
      ]);
      res.json({ status: "ok", chainId, blockNumber: Number(blockNumber) });
    } catch {
      res.status(503).json({ status: "degraded", chainId: 0, blockNumber: 0 });
    }
  });

  // Every other endpoint in docs/openapi.yaml is added in the implementation PRs.
  app.use("/v1", (req, res) => {
    sendError(res, 501, "not_implemented", `${req.method} ${req.originalUrl} is not built yet`);
  });

  app.use((req, res) => {
    sendError(res, 404, "not_found", `No route for ${req.method} ${req.originalUrl}`);
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError) {
      sendError(res, 400, "invalid_request", "Request body is not valid JSON");
      return;
    }
    console.error(err);
    sendError(res, 500, "internal_error", "Unexpected error");
  });

  return app;
}
