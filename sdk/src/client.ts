import { randomUUID } from "node:crypto";
import { MoharApiError, MoharTimeoutError } from "./errors.js";
import type {
  ApiErrorBody,
  Balance,
  ErrorCode,
  Health,
  Price,
  Quote,
  QuoteRequest,
  RegisterWalletRequest,
  Reserve,
  ReserveProof,
  Transaction,
  TransactionList,
  TransferRequest,
  Wallet,
} from "./types.js";

export interface MoharClientOptions {
  /** Partner API key (`mk_test_...`). Keep it on your server. */
  apiKey: string;
  /** Defaults to http://localhost:4000 */
  baseUrl?: string;
  /** Custom fetch implementation (tests, proxies). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Per-request timeout. Default 15 seconds. */
  timeoutMs?: number;
}

export interface IdempotencyOptions {
  /**
   * Unique key for this logical operation. Pass your own (e.g. your order id) so that retrying
   * after a network error cannot buy gold twice. A random key is used if omitted.
   */
  idempotencyKey?: string;
}

export interface ListTransactionsParams {
  walletId?: string;
  limit?: number;
  cursor?: string;
}

export interface WaitOptions {
  /** Give up after this long. Default 60 seconds. */
  timeoutMs?: number;
  /** Poll interval. Default 1.5 seconds. */
  intervalMs?: number;
}

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  idempotencyKey?: string;
  auth?: boolean;
}

const FINAL_STATUSES = new Set<Transaction["status"]>(["confirmed", "failed"]);

/**
 * MOHAR partner client. Server-side only.
 *
 * @example
 * const mohar = new MoharClient({ apiKey: process.env.MOHAR_API_KEY! });
 * const quote = await mohar.createQuote({ walletId, side: "buy", amountPkr: "25000.00" });
 * const txn = await mohar.mint({ quoteId: quote.id }, { idempotencyKey: orderId });
 * const settled = await mohar.waitForTransaction(txn.id);
 */
export class MoharClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: MoharClientOptions) {
    if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
      throw new Error(
        "MoharClient must run on your server. Never expose a MOHAR API key to a browser.",
      );
    }
    if (!options.apiKey) throw new Error("MoharClient: apiKey is required");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "http://localhost:4000").replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  // ------------------------------------------------------------------ system & pricing

  getHealth(): Promise<Health> {
    return this.request("GET", "/v1/health", { auth: false });
  }

  getPrice(): Promise<Price> {
    return this.request("GET", "/v1/price");
  }

  // ------------------------------------------------------------------ wallets

  /** Register a customer's wallet after your own KYC has passed. */
  registerWallet(input: RegisterWalletRequest, options: IdempotencyOptions = {}): Promise<Wallet> {
    return this.request("POST", "/v1/wallets", {
      body: input,
      idempotencyKey: options.idempotencyKey ?? `wallet:${input.externalCustomerId}`,
    });
  }

  getWallet(walletId: string): Promise<Wallet> {
    return this.request("GET", `/v1/wallets/${encodeURIComponent(walletId)}`);
  }

  getBalance(walletId: string): Promise<Balance> {
    return this.request("GET", `/v1/wallets/${encodeURIComponent(walletId)}/balance`);
  }

  // ------------------------------------------------------------------ trading

  /** Lock a price for 60 seconds. Provide exactly one of `amountPkr` or `grams`. */
  createQuote(input: QuoteRequest): Promise<Quote> {
    const hasPkr = input.amountPkr !== undefined;
    const hasGrams = input.grams !== undefined;
    if (hasPkr === hasGrams) {
      return Promise.reject(
        new MoharApiError(400, "invalid_request", "Provide exactly one of amountPkr or grams"),
      );
    }
    return this.request("POST", "/v1/quotes", { body: input });
  }

  /** Buy gold by executing a buy quote. Returns a pending transaction. */
  mint(input: { quoteId: string }, options: IdempotencyOptions = {}): Promise<Transaction> {
    return this.request("POST", "/v1/mints", {
      body: input,
      idempotencyKey: options.idempotencyKey,
    });
  }

  /** Sell gold by executing a sell quote. Pay the customer once it is confirmed. */
  burn(input: { quoteId: string }, options: IdempotencyOptions = {}): Promise<Transaction> {
    return this.request("POST", "/v1/burns", {
      body: input,
      idempotencyKey: options.idempotencyKey,
    });
  }

  /** Send gold between two active wallets. */
  transfer(input: TransferRequest, options: IdempotencyOptions = {}): Promise<Transaction> {
    return this.request("POST", "/v1/transfers", {
      body: input,
      idempotencyKey: options.idempotencyKey,
    });
  }

  // ------------------------------------------------------------------ transactions

  getTransaction(transactionId: string): Promise<Transaction> {
    return this.request("GET", `/v1/transactions/${encodeURIComponent(transactionId)}`);
  }

  listTransactions(params: ListTransactionsParams = {}): Promise<TransactionList> {
    return this.request("GET", "/v1/transactions", { query: { ...params } });
  }

  /**
   * Polls until the transaction is `confirmed` or `failed`. Prefer webhooks in production;
   * this is convenient for scripts, tests and the demo.
   */
  async waitForTransaction(transactionId: string, options: WaitOptions = {}): Promise<Transaction> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    const intervalMs = options.intervalMs ?? 1_500;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const txn = await this.getTransaction(transactionId);
      if (FINAL_STATUSES.has(txn.status)) return txn;
      if (Date.now() + intervalMs > deadline) {
        throw new MoharTimeoutError(
          `Transaction ${transactionId} still ${txn.status} after ${timeoutMs} ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  // ------------------------------------------------------------------ reserve

  /** Latest Proof-of-Reserve attestation (public endpoint). */
  getReserve(): Promise<Reserve> {
    return this.request("GET", "/v1/reserve", { auth: false });
  }

  /** Merkle proof that a wallet's gold is in the latest reserve attestation, checked on-chain. */
  getReserveProof(walletId: string): Promise<ReserveProof> {
    return this.request("GET", `/v1/wallets/${encodeURIComponent(walletId)}/reserve-proof`);
  }

  // ------------------------------------------------------------------ internals

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.auth !== false) headers.Authorization = `Bearer ${this.apiKey}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (method === "POST" && path !== "/v1/quotes") {
      headers["Idempotency-Key"] = opts.idempotencyKey ?? randomUUID();
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new MoharTimeoutError(`${method} ${path} timed out after ${this.timeoutMs} ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    const data: unknown = text ? safeJson(text) : undefined;

    if (!response.ok) {
      const body = data as Partial<ApiErrorBody> | undefined;
      throw new MoharApiError(
        response.status,
        (body?.error?.code as ErrorCode | undefined) ?? "unknown",
        body?.error?.message ?? `MOHAR API responded ${response.status}`,
        body?.error?.details,
      );
    }
    return data as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
