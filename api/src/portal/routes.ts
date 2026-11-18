import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { formatGrams, formatPkr } from "../domain/money.js";
import { valuePaisa } from "../domain/pricing.js";
import type { TransactionRecord, WalletRecord } from "../domain/types.js";
import { ApiError } from "../errors.js";
import { toApiQuote, toApiTransaction } from "../http/presenters.js";
import {
  COMPLIANCE,
  IDLE_SECONDS,
  sessionPartner,
  signedIn,
  VIEWERS,
  type PortalAuth,
  type SignedIn,
} from "./auth.js";
import { portalManageRoutes, type PortalManageContext } from "./manage-routes.js";
import type { PortalStore } from "./portal-store.js";

export interface PortalContext {
  store: PortalStore;
  auth: PortalAuth;
  /** API keys, webhooks, freezes (manage-routes.ts). Absent: read routes only. */
  manage?: Omit<PortalManageContext, "store" | "auth">;
}

const SignInBody = z.object({
  email: z.string().trim().max(254).pipe(z.email()),
  password: z.string().min(1).max(256),
  code: z.string().regex(/^\d{6}$/, "code: six digits"),
});

const walletId = z.string().regex(/^wal_[A-Za-z0-9]+$/);
const limit = z.coerce.number().int().min(1).max(100).default(20);

const WalletQuery = z.object({
  q: z.string().max(128).optional(),
  kycLevel: z.enum(["asaan", "standard", "enhanced"]).optional(),
  limit,
  cursor: z.string().optional(),
});

const TransactionFilters = z.object({
  walletId: walletId.optional(),
  type: z.enum(["mint", "burn", "transfer"]).optional(),
  status: z.enum(["pending", "submitted", "confirmed", "failed"]).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

const TransactionQuery = TransactionFilters.extend({ limit, cursor: z.string().optional() });

const AuditQuery = z.object({
  log: z.enum(["audit", "security"]).default("audit"),
  limit,
  cursor: z.coerce.number().int().positive().optional(),
});

const CSV_MAX_ROWS = 10_000;

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

/** A page of `items` after the one whose id is `cursor`. */
function page<T extends { id: string }>(items: T[], size: number, cursor?: string) {
  const start = cursor ? items.findIndex((i) => i.id === cursor) + 1 : 0;
  const data = items.slice(start, start + size);
  const last = data.at(-1);
  return { data, nextCursor: last && start + size < items.length ? last.id : undefined };
}

/**
 * The partner portal's routes (docs/portal-openapi.yaml). Every partner route reads the
 * partner from the session, so a user can never ask for another partner's data: a wallet or
 * transaction of another partner answers 404, exactly as one that does not exist.
 */
export function portalRoutes(ctx: AppContext, portal: PortalContext): Router {
  const router = Router();
  const { auth, store } = portal;
  const authenticated = auth.authenticate();
  const viewer = [authenticated, auth.requireRole(...VIEWERS)];
  const compliance = [authenticated, auth.requireRole(...COMPLIANCE, "operator")];
  const present = (txn: TransactionRecord) =>
    toApiTransaction(txn, (h) => ctx.chain.explorerTxUrl(h));

  router.use("/portal/v1", auth.sameOrigin());
  if (portal.manage) router.use(portalManageRoutes(ctx, { ...portal.manage, store, auth }));

  function ownWallet(res: Response, id: string): WalletRecord {
    const wallet = ctx.store.getWallet(id);
    if (!wallet || wallet.partnerSlug !== sessionPartner(res)) {
      throw new ApiError(404, "not_found", `Wallet ${id} not found`);
    }
    return wallet;
  }

  function me(res: Response, s: SignedIn) {
    res.json({
      user: {
        id: s.user.id,
        email: s.user.email,
        role: s.user.role,
        ...(s.user.partnerSlug ? { partner: s.user.partnerSlug } : {}),
      },
      sessionExpiresAt: s.session.expiresAt,
      idleTimeoutSeconds: IDLE_SECONDS,
    });
  }

  function filtered(res: Response, filters: z.infer<typeof TransactionFilters>) {
    if (filters.walletId) ownWallet(res, filters.walletId);
    return ctx.store
      .transactionsOf(sessionPartner(res))
      .filter(
        (t) =>
          (!filters.walletId ||
            t.walletId === filters.walletId ||
            t.counterpartyWalletId === filters.walletId) &&
          (!filters.type || t.type === filters.type) &&
          (!filters.status || t.status === filters.status) &&
          (!filters.from || t.createdAt >= new Date(filters.from).toISOString()) &&
          (!filters.to || t.createdAt < new Date(filters.to).toISOString()),
      );
  }

  // ---------------------------------------------------------------- session

  router.post("/portal/v1/session", async (req: Request, res: Response) => {
    const body = parse(SignInBody, req.body);
    const { token, signedIn: s } = await auth.signIn(res, body, req.ip);
    res.setHeader("Set-Cookie", auth.sessionCookie(token));
    me(res, s);
  });

  router.delete("/portal/v1/session", authenticated, (req, res) => {
    auth.signOut(signedIn(res), req.ip);
    res.setHeader("Set-Cookie", auth.clearCookie());
    res.status(204).end();
  });

  router.get("/portal/v1/me", authenticated, (_req, res) => {
    me(res, signedIn(res));
  });

  // ---------------------------------------------------------------- partner data

  router.get("/portal/v1/overview", ...viewer, async (_req, res) => {
    const partner = sessionPartner(res);
    const wallets = ctx.store.walletsOf(partner);
    const transactions = ctx.store.transactionsOf(partner);
    const [balances, price, reserve] = await Promise.all([
      Promise.all(wallets.map((w) => ctx.chain.balanceOf(w.address))),
      ctx.price.current(),
      ctx.chain.latestReserve(),
    ]);
    const held = balances.reduce((sum, b) => sum + b, 0n);
    const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    const volume = transactions
      .filter((t) => t.status === "confirmed" && t.type !== "transfer" && t.createdAt >= since(30))
      .reduce((sum, t) => sum + BigInt(t.netPaisa ?? "0"), 0n);
    res.json({
      partner,
      customers: wallets.length,
      goldHeldGrams: formatGrams(held),
      goldHeldPkr: formatPkr(valuePaisa(held, price)),
      volume30DaysPkr: formatPkr(volume),
      failedLast7Days: transactions.filter((t) => t.status === "failed" && t.createdAt >= since(7))
        .length,
      ...(reserve
        ? {
            reserve: {
              fullyBacked: reserve.attestation.totalGrams >= reserve.tokenSupplyAtPublish,
              asOf: new Date(Number(reserve.attestation.asOf) * 1000).toISOString(),
            },
          }
        : {}),
      latestTransactions: transactions.slice(0, 10).map(present),
    });
  });

  router.get("/portal/v1/wallets", ...viewer, (req, res) => {
    const query = parse(WalletQuery, req.query);
    const needle = query.q?.trim().toLowerCase();
    const matching = ctx.store
      .walletsOf(sessionPartner(res))
      .filter(
        (w) =>
          (!query.kycLevel || w.kycLevel === query.kycLevel) &&
          (!needle ||
            w.externalCustomerId.toLowerCase().includes(needle) ||
            w.id.toLowerCase().includes(needle) ||
            w.address.toLowerCase().includes(needle)),
      );
    const { data, nextCursor } = page(matching, query.limit, query.cursor);
    res.json({
      data: data.map((w) => ({
        id: w.id,
        externalCustomerId: w.externalCustomerId,
        address: w.address,
        kycLevel: w.kycLevel,
        createdAt: w.createdAt,
      })),
      ...(nextCursor ? { nextCursor } : {}),
    });
  });

  router.get("/portal/v1/wallets/:walletId", ...viewer, async (req, res) => {
    const wallet = ownWallet(res, parse(walletId, req.params.walletId));
    const [active, balance, price] = await Promise.all([
      ctx.chain.isWalletActive(wallet.address),
      ctx.chain.balanceOf(wallet.address),
      ctx.price.current(),
    ]);
    const limit = ctx.settings.kycLimits[wallet.kycLevel];
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const holding = valuePaisa(balance, price);
    const explorerUrl = ctx.chain.explorerAddressUrl(wallet.address);
    res.json({
      id: wallet.id,
      externalCustomerId: wallet.externalCustomerId,
      address: wallet.address,
      kycLevel: wallet.kycLevel,
      createdAt: wallet.createdAt,
      status: active ? "active" : "frozen",
      balanceGrams: formatGrams(balance),
      valuePkr: formatPkr(holding),
      ...(explorerUrl ? { explorerUrl } : {}),
      limits: {
        perTradePkr: formatPkr(limit.perTradePaisa),
        last24Hours: {
          limitPkr: formatPkr(limit.per24HoursPaisa),
          usedPkr: formatPkr(ctx.store.creditedSince(wallet.id, hoursAgo(24))),
        },
        last30Days: {
          limitPkr: formatPkr(limit.per30DaysPaisa),
          usedPkr: formatPkr(ctx.store.creditedSince(wallet.id, hoursAgo(24 * 30))),
        },
        holding: { limitPkr: formatPkr(limit.maxHoldingPaisa), usedPkr: formatPkr(holding) },
      },
    });
  });

  router.get("/portal/v1/transactions", ...viewer, (req, res) => {
    const query = parse(TransactionQuery, req.query);
    const { data, nextCursor } = page(filtered(res, query), query.limit, query.cursor);
    res.json({ data: data.map(present), ...(nextCursor ? { nextCursor } : {}) });
  });

  router.get(
    "/portal/v1/transactions.csv",
    authenticated,
    auth.requireRole(...COMPLIANCE),
    (req, res) => {
      const query = parse(TransactionFilters.omit({ walletId: true }), req.query);
      const rows = filtered(res, query).slice(0, CSV_MAX_ROWS);
      const s = signedIn(res);
      store.log("audit", {
        userId: s.user.id,
        email: s.user.email,
        partner: s.user.partnerSlug,
        action: "transactions.export",
        result: "ok",
        detail: { rows: rows.length, filters: query },
        ip: req.ip,
      });
      const header = [
        "id",
        "type",
        "status",
        "walletId",
        "counterpartyWalletId",
        "grams",
        "netAmountPkr",
        "txHash",
        "blockNumber",
        "failureCode",
        "createdAt",
        "confirmedAt",
      ];
      const lines = rows.map((t) =>
        [
          t.id,
          t.type,
          t.status,
          t.walletId,
          t.counterpartyWalletId,
          formatGrams(BigInt(t.grams)),
          t.netPaisa ? formatPkr(BigInt(t.netPaisa)) : undefined,
          t.txHash,
          t.blockNumber,
          t.failureCode,
          t.createdAt,
          t.confirmedAt,
        ]
          .map(csvField)
          .join(","),
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="mohar-transactions-${sessionPartner(res)}.csv"`,
      );
      res.send([header.join(","), ...lines].join("\r\n") + "\r\n");
    },
  );

  router.get("/portal/v1/transactions/:transactionId", ...viewer, (req, res) => {
    const txn = ctx.store.getTransaction(String(req.params.transactionId));
    if (!txn || txn.partnerSlug !== sessionPartner(res)) {
      throw new ApiError(404, "not_found", `Transaction ${req.params.transactionId} not found`);
    }
    const quote = txn.quoteId ? ctx.store.getQuote(txn.quoteId) : undefined;
    res.json({
      transaction: present(txn),
      ...(quote ? { quote: toApiQuote(quote) } : {}),
      ...(txn.failureMessage ? { failureMessage: txn.failureMessage } : {}),
    });
  });

  router.get("/portal/v1/limits", ...viewer, (_req, res) => {
    const wallets = ctx.store.walletsOf(sessionPartner(res));
    const levels = (["asaan", "standard", "enhanced"] as const).map((level) => {
      const l = ctx.settings.kycLimits[level];
      return {
        level,
        perTradePkr: formatPkr(l.perTradePaisa),
        per24HoursPkr: formatPkr(l.per24HoursPaisa),
        per30DaysPkr: formatPkr(l.per30DaysPaisa),
        maxHoldingPkr: formatPkr(l.maxHoldingPaisa),
        customers: wallets.filter((w) => w.kycLevel === level).length,
      };
    });
    res.json({ levels });
  });

  // ---------------------------------------------------------------- compliance

  router.get("/portal/v1/audit", ...compliance, (req, res) => {
    const query = parse(AuditQuery, req.query);
    const s = signedIn(res);
    // An operator sees every partner; anyone else only their own partner's entries.
    const partner = s.user.role === "operator" ? undefined : sessionPartner(res);
    const result = store.listLog(query.log, {
      partner,
      limit: query.limit,
      cursor: query.cursor,
    });
    res.json({
      data: result.data,
      ...(result.nextCursor !== undefined ? { nextCursor: String(result.nextCursor) } : {}),
    });
  });

  router.get("/portal/v1/audit/verify", ...compliance, (_req, res) => {
    res.json({ audit: store.verifyLog("audit"), security: store.verifyLog("security") });
  });

  return router;
}

/**
 * One CSV field. Quotes it when needed, and puts a ' before a leading = + - @ so a spreadsheet
 * does not run it as a formula (CSV injection).
 */
export function csvField(value: string | number | undefined): string {
  if (value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
