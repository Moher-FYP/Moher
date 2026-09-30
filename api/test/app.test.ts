import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { MoharChain } from "../src/chain/mohar-chain.js";
import type { AppContext } from "../src/context.js";
import { PartnerDirectory } from "../src/http/auth.js";
import { SerialQueue } from "../src/lib/queue.js";
import { Store } from "../src/store/store.js";

const API_KEY = "mk_test_unit";

/** Just enough of the context for HTTP-level tests; on-chain flows are covered by e2e.test.ts. */
function fakeContext(chainOverrides: Partial<Record<keyof MoharChain, unknown>> = {}) {
  const store = new Store(null);
  store.open("unit");
  const registerWallet = vi.fn(async () => ({ hash: "0x01", blockNumber: 1n }));
  const chain = {
    getChainId: async () => 31337,
    getBlockNumber: async () => 42n,
    isWalletActive: async () => true,
    registerWallet,
    explorerTxUrl: () => undefined,
    deployment: { mockFeed: false },
    ...chainOverrides,
  } as unknown as MoharChain;

  const ctx = {
    chain,
    store,
    queue: new SerialQueue(),
    partners: new PartnerDirectory(`${API_KEY}=demo-bank`, ""),
    deriveWalletAddress: (i: number) =>
      `0x${(i + 1).toString(16).padStart(40, "0")}` as `0x${string}`,
    settings: {
      fees: { platformFeeBps: 50n, fxMarginBps: 25n },
      quoteTtlSeconds: 60,
      devRoutes: false,
    },
  } as unknown as AppContext;
  return { ctx, registerWallet };
}

const walletBody = (externalCustomerId: string) => ({
  externalCustomerId,
  kyc: {
    reference: `kyc-${externalCustomerId}`,
    level: "standard",
    verifiedAt: "2026-10-01T00:00:00Z",
  },
});

describe("health and errors", () => {
  it("reports health with chain id and block number", async () => {
    const res = await request(createApp(fakeContext().ctx)).get("/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", chainId: 31337, blockNumber: 42 });
  });

  it("reports degraded when the chain is unreachable", async () => {
    const { ctx } = fakeContext({
      getChainId: async () => {
        throw new Error("connection refused");
      },
    });
    const res = await request(createApp(ctx)).get("/v1/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
  });

  it("uses the spec's error shape for unknown routes and bad JSON", async () => {
    const app = createApp(fakeContext().ctx);
    const missing = await request(app).get("/v1/nope");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("not_found");

    const bad = await request(app)
      .post("/v1/quotes")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("invalid_request");
  });
});

describe("auth", () => {
  it("rejects missing and unknown API keys", async () => {
    const app = createApp(fakeContext().ctx);
    expect((await request(app).get("/v1/price")).status).toBe(401);
    const wrong = await request(app).get("/v1/price").set("Authorization", "Bearer mk_nope");
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("unauthorized");
  });
});

describe("wallet registration and idempotency", () => {
  it("registers once per customer and returns the same wallet afterwards", async () => {
    const { ctx, registerWallet } = fakeContext();
    const app = createApp(ctx);

    const first = await request(app)
      .post("/v1/wallets")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Idempotency-Key", "wallet-cust-1")
      .send(walletBody("cust-1"));
    expect(first.status).toBe(201);
    expect(first.body.id).toMatch(/^wal_/);
    expect(first.body.status).toBe("active");

    const again = await request(app)
      .post("/v1/wallets")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Idempotency-Key", "wallet-cust-1-retry")
      .send(walletBody("cust-1"));
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(registerWallet).toHaveBeenCalledTimes(1);
  });

  it("stores only a hash of the KYC reference", async () => {
    const { ctx, registerWallet } = fakeContext();
    await request(createApp(ctx))
      .post("/v1/wallets")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Idempotency-Key", "wallet-cust-2")
      .send(walletBody("cust-2"));
    const [, , kycHash] = registerWallet.mock.calls[0] as unknown as [string, string, string];
    expect(kycHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(kycHash).not.toContain("cust-2");
  });

  it("requires an Idempotency-Key and replays or rejects reuse", async () => {
    const { ctx, registerWallet } = fakeContext();
    const app = createApp(ctx);
    const post = (key: string | undefined, body: object) => {
      const req = request(app).post("/v1/wallets").set("Authorization", `Bearer ${API_KEY}`);
      if (key) req.set("Idempotency-Key", key);
      return req.send(body);
    };

    expect((await post(undefined, walletBody("cust-3"))).status).toBe(400);

    const original = await post("same-key-123", walletBody("cust-3"));
    const replay = await post("same-key-123", walletBody("cust-3"));
    expect(replay.status).toBe(original.status);
    expect(replay.body).toEqual(original.body);
    expect(replay.headers["idempotent-replayed"]).toBe("true");

    const conflict = await post("same-key-123", walletBody("cust-4"));
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("idempotency_conflict");
    expect(registerWallet).toHaveBeenCalledTimes(1);
  });

  it("validates the body against the spec", async () => {
    const res = await request(createApp(fakeContext().ctx))
      .post("/v1/wallets")
      .set("Authorization", `Bearer ${API_KEY}`)
      .set("Idempotency-Key", "wallet-bad-1")
      .send({ externalCustomerId: "x", kyc: { reference: "r", level: "gold", verifiedAt: "no" } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/kyc\.level/);
  });
});
