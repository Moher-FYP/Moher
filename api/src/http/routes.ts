import { Router, type Request, type Response } from "express";
import { keccak256, toHex } from "viem";
import { z } from "zod";
import { mapChainError } from "../chain/errors.js";
import type { AppContext } from "../context.js";
import { formatGrams, formatPkr, parseDecimal, parseGrams, parsePkr } from "../domain/money.js";
import { computeQuote, valuePaisa, type QuoteAmount } from "../domain/pricing.js";
import type { QuoteRecord, WalletRecord } from "../domain/types.js";
import { ApiError } from "../errors.js";
import { newId } from "../lib/ids.js";
import { holdingRef } from "../vault/mock-vault.js";
import { partnerOf, requirePartner } from "./auth.js";
import { idempotent } from "./idempotency.js";
import { toApiPrice, toApiQuote, toApiTransaction, toApiWallet } from "./presenters.js";

// ------------------------------------------------------------------ request schemas

const grams = z.string().regex(/^\d+(\.\d{1,8})?$/, "grams: up to 8 decimals");
const pkr = z.string().regex(/^\d+(\.\d{1,2})?$/, "PKR: up to 2 decimals");
const walletId = z.string().regex(/^wal_[A-Za-z0-9]+$/);
const quoteId = z.string().regex(/^qt_[A-Za-z0-9]+$/);

const RegisterWalletBody = z.object({
  externalCustomerId: z.string().min(1).max(128),
  kyc: z.object({
    reference: z.string().min(1).max(256),
    level: z.enum(["asaan", "standard", "enhanced"]),
    verifiedAt: z.string().datetime({ offset: true }),
  }),
});

const QuoteBody = z
  .object({
    walletId,
    side: z.enum(["buy", "sell"]),
    amountPkr: pkr.optional(),
    grams: grams.optional(),
  })
  .refine((b) => (b.amountPkr === undefined) !== (b.grams === undefined), {
    message: "Provide exactly one of amountPkr or grams",
  });

const ExecuteQuoteBody = z.object({ quoteId });

const TransferBody = z.object({
  fromWalletId: walletId,
  toWalletId: walletId,
  grams,
});

const ListQuery = z.object({
  walletId: walletId.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

const DevPriceBody = z.object({ xauUsd: z.string().regex(/^\d+(\.\d{1,8})?$/) });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    throw new ApiError(400, "invalid_request", message);
  }
  return result.data;
}

// ------------------------------------------------------------------ routes

export function partnerRoutes(ctx: AppContext): Router {
  const router = Router();
  const auth = requirePartner(ctx.partners);
  const once = idempotent(ctx.store);
  const present = (txn: Parameters<typeof toApiTransaction>[0]) =>
    toApiTransaction(txn, (h) => ctx.chain.explorerTxUrl(h));

  /** A wallet that exists and belongs to the calling partner. */
  function ownWallet(res: Response, id: string): WalletRecord {
    const wallet = ctx.store.getWallet(id);
    if (!wallet || wallet.partnerSlug !== partnerOf(res).slug) {
      throw new ApiError(404, "not_found", `Wallet ${id} not found`);
    }
    return wallet;
  }

  async function requireActive(wallet: WalletRecord): Promise<void> {
    if (!(await ctx.chain.isWalletActive(wallet.address))) {
      throw new ApiError(409, "wallet_frozen", `Wallet ${wallet.id} is frozen or inactive`);
    }
  }

  async function requireBalance(wallet: WalletRecord, needed: bigint): Promise<void> {
    const balance = await ctx.chain.balanceOf(wallet.address);
    if (balance < needed) {
      throw new ApiError(409, "insufficient_balance", "Not enough gold in the wallet", {
        balanceGrams: formatGrams(balance),
        requiredGrams: formatGrams(needed),
      });
    }
  }

  function usableQuote(res: Response, id: string, side: "buy" | "sell"): QuoteRecord {
    const quote = ctx.store.getQuote(id);
    if (!quote || quote.partnerSlug !== partnerOf(res).slug) {
      throw new ApiError(404, "not_found", `Quote ${id} not found`);
    }
    if (quote.side !== side) {
      const route = quote.side === "buy" ? "/v1/mints" : "/v1/burns";
      throw new ApiError(400, "invalid_request", `This is a ${quote.side} quote; use ${route}`);
    }
    if (quote.usedByTransactionId) {
      throw new ApiError(409, "invalid_request", "This quote was already executed", {
        transactionId: quote.usedByTransactionId,
      });
    }
    if (Date.parse(quote.expiresAt) < Date.now()) {
      throw new ApiError(409, "quote_expired", "The quote expired. Request a new one.");
    }
    return quote;
  }

  // ---------------------------------------------------------------- public

  router.get("/v1/health", async (_req, res) => {
    try {
      const [chainId, blockNumber] = await Promise.all([
        ctx.chain.getChainId(),
        ctx.chain.getBlockNumber(),
      ]);
      res.json({ status: "ok", chainId, blockNumber: Number(blockNumber) });
    } catch {
      res.status(503).json({ status: "degraded", chainId: 0, blockNumber: 0 });
    }
  });

  router.get("/v1/reserve", async (_req, res) => {
    const latest = await ctx.chain.latestReserve();
    if (!latest) throw new ApiError(404, "not_found", "No reserve attestation published yet");
    const { attestation, tokenSupplyAtPublish, publishedAt } = latest;
    const address = ctx.chain.deployment.reserveRegistry;
    const explorerUrl = ctx.chain.explorerAddressUrl(address);
    res.json({
      totalGramsInVault: formatGrams(attestation.totalGrams),
      tokenSupplyGrams: formatGrams(tokenSupplyAtPublish),
      differenceGrams: formatGrams(attestation.totalGrams - tokenSupplyAtPublish),
      fullyBacked: attestation.totalGrams >= tokenSupplyAtPublish,
      allocationsRoot: attestation.allocationsRoot,
      asOf: new Date(Number(attestation.asOf) * 1000).toISOString(),
      publishedAt: new Date(Number(publishedAt) * 1000).toISOString(),
      nonce: Number(attestation.nonce),
      attestor: ctx.chain.deployment.vaultSigner,
      contractAddress: address,
      ...(explorerUrl ? { explorerUrl } : {}),
    });
  });

  // ---------------------------------------------------------------- partner

  router.get("/v1/price", auth, async (_req, res) => {
    res.json(toApiPrice(await ctx.price.current()));
  });

  router.post("/v1/wallets", auth, once, async (req: Request, res: Response) => {
    const body = parse(RegisterWalletBody, req.body);
    const partner = partnerOf(res);

    const result = await ctx.queue.run(async () => {
      const existing = ctx.store.findWalletByCustomer(partner.slug, body.externalCustomerId);
      if (existing) return { wallet: existing, created: false };

      const index = ctx.store.nextDerivationIndex();
      const address = ctx.deriveWalletAddress(index);
      const kycAttestationHash = keccak256(toHex(body.kyc.reference));
      try {
        await ctx.chain.registerWallet(address, partner.partnerId, kycAttestationHash);
      } catch (error) {
        const failure = mapChainError(error);
        throw new ApiError(502, "internal_error", `Wallet registration failed: ${failure.message}`);
      }
      const wallet: WalletRecord = {
        id: newId("wal"),
        partnerSlug: partner.slug,
        externalCustomerId: body.externalCustomerId,
        address,
        kycLevel: body.kyc.level,
        kycAttestationHash,
        derivationIndex: index,
        createdAt: new Date().toISOString(),
      };
      ctx.store.saveWallet(wallet);
      return { wallet, created: true };
    });

    res.status(result.created ? 201 : 200).json(toApiWallet(result.wallet, true));
  });

  router.get("/v1/wallets/:walletId", auth, async (req, res) => {
    const wallet = ownWallet(res, String(req.params.walletId));
    res.json(toApiWallet(wallet, await ctx.chain.isWalletActive(wallet.address)));
  });

  router.get("/v1/wallets/:walletId/balance", auth, async (req, res) => {
    const wallet = ownWallet(res, String(req.params.walletId));
    const [balance, price] = await Promise.all([
      ctx.chain.balanceOf(wallet.address),
      ctx.price.current(),
    ]);
    res.json({
      walletId: wallet.id,
      grams: formatGrams(balance),
      valuePkr: formatPkr(valuePaisa(balance, price)),
      price: toApiPrice(price),
    });
  });

  router.get("/v1/wallets/:walletId/reserve-proof", auth, async (req, res) => {
    const wallet = ownWallet(res, String(req.params.walletId));
    const proof = ctx.vault.proof(wallet.address);
    if (!proof) throw new ApiError(404, "not_found", "This wallet holds no allocated gold");
    const verifiedOnChain = await ctx.chain.verifyAllocation(
      proof.ref,
      wallet.address,
      proof.grams,
      proof.proof,
    );
    res.json({
      walletId: wallet.id,
      address: wallet.address,
      allocationRef: holdingRef(wallet.address),
      grams: formatGrams(proof.grams),
      proof: proof.proof,
      verifiedOnChain,
      contractAddress: ctx.chain.deployment.reserveRegistry,
    });
  });

  router.post("/v1/quotes", auth, async (req, res) => {
    const body = parse(QuoteBody, req.body);
    const partner = partnerOf(res);
    const wallet = ownWallet(res, body.walletId);
    await requireActive(wallet);

    const price = await ctx.price.current();
    const amount: QuoteAmount =
      body.amountPkr !== undefined
        ? { amountPaisa: parsePkr(body.amountPkr) }
        : { grams: parseGrams(body.grams as string) };
    const math = computeQuote(body.side, amount, price, ctx.settings.fees);
    if (body.side === "sell") await requireBalance(wallet, math.grams);

    const now = Date.now();
    const quote: QuoteRecord = {
      id: newId("qt"),
      partnerSlug: partner.slug,
      walletId: wallet.id,
      side: body.side,
      grams: math.grams.toString(),
      grossPaisa: math.grossPaisa.toString(),
      netPaisa: math.netPaisa.toString(),
      fxMarginPaisa: math.fxMarginPaisa.toString(),
      platformFeePaisa: math.platformFeePaisa.toString(),
      xauUsdE8: price.xauUsdE8.toString(),
      usdPkrE4: price.usdPkrE4.toString(),
      priceUpdatedAt: price.updatedAt.toString(),
      priceSource: price.source,
      expiresAt: new Date(now + ctx.settings.quoteTtlSeconds * 1000).toISOString(),
      createdAt: new Date(now).toISOString(),
    };
    ctx.store.saveQuote(quote);
    res.status(201).json(toApiQuote(quote));
  });

  router.post("/v1/mints", auth, once, async (req, res) => {
    const { quoteId: id } = parse(ExecuteQuoteBody, req.body);
    const quote = usableQuote(res, id, "buy");
    const wallet = ownWallet(res, quote.walletId);
    await requireActive(wallet);
    if (await ctx.chain.mintingPaused()) {
      throw new ApiError(409, "minting_paused", "Minting is paused");
    }
    const txn = ctx.settlement.startMint(partnerOf(res), quote, wallet);
    ctx.store.saveQuote({ ...quote, usedByTransactionId: txn.id });
    res.status(202).json(present(txn));
  });

  router.post("/v1/burns", auth, once, async (req, res) => {
    const { quoteId: id } = parse(ExecuteQuoteBody, req.body);
    const quote = usableQuote(res, id, "sell");
    const wallet = ownWallet(res, quote.walletId);
    await requireActive(wallet);
    await requireBalance(wallet, BigInt(quote.grams));
    const txn = ctx.settlement.startBurn(partnerOf(res), quote, wallet);
    ctx.store.saveQuote({ ...quote, usedByTransactionId: txn.id });
    res.status(202).json(present(txn));
  });

  router.post("/v1/transfers", auth, once, async (req, res) => {
    const body = parse(TransferBody, req.body);
    const from = ownWallet(res, body.fromWalletId);
    const to = ctx.store.getWallet(body.toWalletId);
    if (!to) throw new ApiError(404, "not_found", `Wallet ${body.toWalletId} not found`);
    if (from.id === to.id) {
      throw new ApiError(400, "invalid_request", "Cannot transfer to the same wallet");
    }
    const amount = parseGrams(body.grams);
    if (amount <= 0n) throw new ApiError(400, "invalid_request", "grams must be greater than 0");
    await requireActive(from);
    await requireActive(to);
    await requireBalance(from, amount);
    const txn = ctx.settlement.startTransfer(partnerOf(res), from, to, amount);
    res.status(202).json(present(txn));
  });

  router.get("/v1/transactions", auth, (req, res) => {
    const query = parse(ListQuery, req.query);
    if (query.walletId) ownWallet(res, query.walletId);
    const page = ctx.store.listTransactions(partnerOf(res).slug, query);
    res.json({
      data: page.data.map(present),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    });
  });

  router.get("/v1/transactions/:transactionId", auth, (req, res) => {
    const txn = ctx.store.getTransaction(String(req.params.transactionId));
    if (!txn || txn.partnerSlug !== partnerOf(res).slug) {
      throw new ApiError(404, "not_found", `Transaction ${req.params.transactionId} not found`);
    }
    res.json(present(txn));
  });

  // ---------------------------------------------------------------- dev (local demo only)

  if (ctx.settings.devRoutes && ctx.chain.deployment.mockFeed) {
    /** Move the mock gold price, e.g. to demo a trade rejected for moving > 0.50%. */
    router.post("/dev/price", auth, async (req, res) => {
      const body = parse(DevPriceBody, req.body);
      res.json(toApiPrice(await ctx.price.setMockPrice(parseDecimal(body.xauUsd, 8))));
    });
  }

  return router;
}
