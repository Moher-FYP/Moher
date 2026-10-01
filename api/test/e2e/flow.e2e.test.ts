import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MoharApiError,
  MoharClient,
  verifyWebhookSignature,
  type Transaction,
  type TransactionEvent,
} from "@mohar/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { bootstrap } from "../../src/bootstrap.js";
import { loadConfig } from "../../src/config.js";
import type { AppContext } from "../../src/context.js";

/**
 * The FYP demo flow, end to end, exactly as a partner bank would run it:
 *   Anvil  ←  contracts (Deploy.s.sol)  ←  MOHAR API  ←  @mohar/sdk  ←  this test (the "bank")
 * Requires Foundry (anvil + forge) on PATH; skipped otherwise.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PORT = 18_545;
const RPC_URL = `http://127.0.0.1:${PORT}`;
const API_KEY = "mk_test_e2e";
const WEBHOOK_SECRET = "whsec_e2e_secret";

const hasFoundry = spawnSync("anvil", ["--version"]).status === 0;

describe.skipIf(!hasFoundry)("MOHAR end to end (Anvil + API + SDK)", () => {
  let anvil: ChildProcess;
  let api: Server;
  let webhookServer: Server;
  let ctx: AppContext;
  let mohar: MoharClient;
  const webhooks: { body: string; signature: string }[] = [];

  let alice: string;
  let bob: string;

  beforeAll(async () => {
    anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
    await waitFor(async () => (await rpc("eth_chainId")) === "0x7a69");

    const deploy = spawnSync(
      "forge",
      ["script", "script/Deploy.s.sol", "--rpc-url", RPC_URL, "--broadcast"],
      { cwd: join(ROOT, "contracts"), encoding: "utf8" },
    );
    if (deploy.status !== 0) throw new Error(`Deploy failed:\n${deploy.stdout}\n${deploy.stderr}`);

    webhookServer = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        webhooks.push({ body, signature: String(req.headers["mohar-signature"]) });
        res.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) => webhookServer.listen(0, resolve));
    const webhookPort = (webhookServer.address() as AddressInfo).port;

    ctx = await bootstrap(
      loadConfig({
        RPC_URL,
        DEPLOYMENT_FILE: join(ROOT, "contracts", "deployments", "31337.json"),
        DATA_DIR: ":memory:",
        PARTNER_API_KEYS: `${API_KEY}=demo-bank`,
        PARTNER_WEBHOOK_URLS: `demo-bank=http://127.0.0.1:${webhookPort}/webhooks`,
        WEBHOOK_SECRET,
      }),
    );
    api = createApp(ctx).listen(0);
    await new Promise((resolve) => api.once("listening", resolve));
    mohar = new MoharClient({
      apiKey: API_KEY,
      baseUrl: `http://127.0.0.1:${(api.address() as AddressInfo).port}`,
    });
  });

  afterAll(async () => {
    ctx?.price.stopKeeper();
    await ctx?.settlement.idle();
    api?.close();
    webhookServer?.close();
    anvil?.kill();
  });

  const settle = (txn: Transaction) => mohar.waitForTransaction(txn.id, { intervalMs: 200 });

  it("is healthy on the local chain", async () => {
    const health = await mohar.getHealth();
    expect(health.status).toBe("ok");
    expect(health.chainId).toBe(31337);
  });

  it("registers customer wallets after the bank's KYC", async () => {
    const kyc = { level: "standard" as const, verifiedAt: new Date().toISOString() };
    const a = await mohar.registerWallet({
      externalCustomerId: "hassan-001",
      kyc: { ...kyc, reference: "HBL-KYC-001" },
    });
    const b = await mohar.registerWallet({
      externalCustomerId: "bushra-002",
      kyc: { ...kyc, reference: "HBL-KYC-002" },
    });
    expect(a.status).toBe("active");
    expect(a.address).not.toBe(b.address);
    alice = a.id;
    bob = b.id;
  });

  it("quotes a price with fees", async () => {
    const price = await mohar.getPrice();
    expect(price.xauUsd).toBe("4616.00");
    expect(price.source).toBe("mock");
    expect(Number(price.pricePerGramPkr)).toBeGreaterThan(40_000);
  });

  it("buys PKR 25,000 of gold (Hassan's use case) and settles on-chain", async () => {
    const quote = await mohar.createQuote({ walletId: alice, side: "buy", amountPkr: "25000.00" });
    expect(quote.netAmountPkr).toBe("25000.00");

    const pending = await mohar.mint({ quoteId: quote.id }, { idempotencyKey: "order-hassan-1" });
    expect(pending.status).toBe("pending");

    const txn = await settle(pending);
    expect(txn.status).toBe("confirmed");
    expect(txn.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const balance = await mohar.getBalance(alice);
    expect(balance.grams).toBe(quote.grams);
  });

  it("replays the same mint instead of buying twice", async () => {
    const quote = await mohar.createQuote({ walletId: alice, side: "buy", amountPkr: "1000.00" });
    const first = await mohar.mint({ quoteId: quote.id }, { idempotencyKey: "order-dup-1" });
    const second = await mohar.mint({ quoteId: quote.id }, { idempotencyKey: "order-dup-1" });
    expect(second.id).toBe(first.id);
    await settle(first);
  });

  it("sends a signed webhook the bank can verify with the SDK", async () => {
    await waitFor(async () => webhooks.length > 0);
    const hook = webhooks[0]!;
    const event: TransactionEvent = verifyWebhookSignature({
      payload: hook.body,
      header: hook.signature,
      secret: WEBHOOK_SECRET,
    });
    expect(event.type).toBe("transaction.confirmed");
    expect(event.data.type).toBe("mint");
  });

  it("publishes Proof-of-Reserve covering every token, verifiable per wallet", async () => {
    const reserve = await mohar.getReserve();
    expect(reserve.fullyBacked).toBe(true);
    expect(reserve.totalGramsInVault).toBe(reserve.tokenSupplyGrams);
    expect(reserve.differenceGrams).toBe("0.00000000");

    const proof = await mohar.getReserveProof(alice);
    expect(proof.verifiedOnChain).toBe(true);
    expect(proof.grams).toBe((await mohar.getBalance(alice)).grams);
  });

  it("transfers gold between customers", async () => {
    const before = await mohar.getBalance(alice);
    const txn = await settle(
      await mohar.transfer({ fromWalletId: alice, toWalletId: bob, grams: "0.1" }),
    );
    expect(txn.status).toBe("confirmed");
    expect((await mohar.getBalance(bob)).grams).toBe("0.10000000");
    expect(Number((await mohar.getBalance(alice)).grams)).toBeCloseTo(
      Number(before.grams) - 0.1,
      8,
    );
  });

  it("sells gold (Bushra's use case) and reports the PKR to pay out", async () => {
    const quote = await mohar.createQuote({ walletId: bob, side: "sell", grams: "0.05" });
    const txn = await settle(await mohar.burn({ quoteId: quote.id }));
    expect(txn.status).toBe("confirmed");
    expect(txn.netAmountPkr).toBe(quote.netAmountPkr);
    expect((await mohar.getBalance(bob)).grams).toBe("0.05000000");
  });

  it("refuses to sell more gold than the wallet holds", async () => {
    const error = await mohar
      .createQuote({ walletId: bob, side: "sell", grams: "5" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MoharApiError);
    expect((error as MoharApiError).code).toBe("insufficient_balance");
  });

  it("rejects a trade when gold moves more than 0.50% after the quote (gharar control)", async () => {
    const before = await mohar.getBalance(alice);
    const quote = await mohar.createQuote({ walletId: alice, side: "buy", amountPkr: "5000.00" });

    // The market jumps 1% between quote and execution.
    const moved = await fetch(`${apiBase()}/dev/price`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ xauUsd: "4662.16" }),
    });
    expect(moved.status).toBe(200);

    const txn = await settle(await mohar.mint({ quoteId: quote.id }));
    expect(txn.status).toBe("failed");
    expect(txn.failureCode).toBe("price_moved");
    expect((await mohar.getBalance(alice)).grams).toBe(before.grams);

    // Supply and vault still agree after the failed trade.
    expect((await mohar.getReserve()).fullyBacked).toBe(true);
  });

  it("lists the wallet's transactions, newest first", async () => {
    const list = await mohar.listTransactions({ walletId: alice });
    expect(list.data.length).toBeGreaterThanOrEqual(4);
    expect(list.data[0]!.status).toBe("failed");
    expect(list.data.map((t) => t.type)).toContain("transfer");
  });

  function apiBase(): string {
    return `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  }
});

async function rpc(method: string): Promise<unknown> {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
    });
    return ((await res.json()) as { result: unknown }).result;
  } catch {
    return undefined;
  }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for condition");
}
