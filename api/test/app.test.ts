import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

const healthyChain = {
  getChainId: async () => 31337,
  getBlockNumber: async () => 42n,
};

const brokenChain = {
  getChainId: async () => {
    throw new Error("connection refused");
  },
  getBlockNumber: async () => 0n,
};

describe("API scaffold", () => {
  it("reports health with chain id and block number", async () => {
    const res = await request(createApp({ chain: healthyChain })).get("/v1/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", chainId: 31337, blockNumber: 42 });
  });

  it("reports degraded when the chain is unreachable", async () => {
    const res = await request(createApp({ chain: brokenChain })).get("/v1/health");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
  });

  it("returns the spec's error shape for endpoints not built yet", async () => {
    const res = await request(createApp({ chain: healthyChain })).get("/v1/price");

    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe("not_implemented");
  });

  it("rejects malformed JSON with invalid_request", async () => {
    const res = await request(createApp({ chain: healthyChain }))
      .post("/v1/quotes")
      .set("Content-Type", "application/json")
      .send("{not json");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
  });
});
