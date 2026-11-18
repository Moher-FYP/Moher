import request from "supertest";
import { expect } from "vitest";
import { createApp } from "../src/app.js";
import type { ComplianceSigner } from "../src/chain/compliance.js";
import type { MoharChain } from "../src/chain/mohar-chain.js";
import type { AppContext } from "../src/context.js";
import { DEFAULT_KYC_LIMITS, parseKycLimits } from "../src/domain/kyc-limits.js";
import type { TransactionRecord, WalletRecord } from "../src/domain/types.js";
import { PartnerDirectory } from "../src/http/auth.js";
import { SerialQueue } from "../src/lib/queue.js";
import { PortalAuth } from "../src/portal/auth.js";
import { applyPortalSettings } from "../src/portal/keys.js";
import { hashPassword } from "../src/portal/passwords.js";
import { PortalStore, type PortalRole } from "../src/portal/portal-store.js";
import { Sealer } from "../src/portal/sealed.js";
import { codeAt, counterAt, newTotpSecret } from "../src/portal/totp.js";
import { WebhookSender } from "../src/services/webhooks.js";
import { Store } from "../src/store/store.js";

/** Shared by the portal tests: an app with two partners, five portal users and a fake chain. */

export const ORIGIN = "http://localhost:3002";
export const PASSWORD = "correct horse battery staple";
export const START = new Date("2026-11-18T10:00:00Z");

export interface Sent {
  url: string;
  headers: Record<string, string>;
  body: string;
}

const wallet = (id: string, partnerSlug: string, externalCustomerId: string): WalletRecord => ({
  id,
  partnerSlug,
  externalCustomerId,
  address: `0x${id.slice(4).padStart(40, "0")}` as `0x${string}`,
  kycLevel: "asaan",
  kycAttestationHash: `0x${"0".repeat(64)}`,
  derivationIndex: 0,
  createdAt: "2026-11-17T09:00:00Z",
});

const txn = (id: string, partnerSlug: string, walletId: string): TransactionRecord => ({
  id,
  partnerSlug,
  type: "mint",
  status: "confirmed",
  walletId,
  grams: "71557733",
  netPaisa: "2500000",
  createdAt: "2026-11-17T10:00:00Z",
});

export async function setup(
  options: { compliance?: ComplianceSigner; webhookStatus?: number } = {},
) {
  const clock = { now: new Date(START) };
  const now = () => clock.now;
  const store = new Store(null);
  store.open("unit");
  store.saveWallet(wallet("wal_bank1", "demo-bank", "CUST-1"));
  store.saveWallet(wallet("wal_other1", "moher-wallet", "=cmd|calc"));
  store.saveTransaction(txn("txn_bank1", "demo-bank", "wal_bank1"));
  store.saveTransaction(txn("txn_other1", "moher-wallet", "wal_other1"));

  const sealer = new Sealer("unit-test-portal-key");
  const portalStore = new PortalStore(null, now);
  const auth = new PortalAuth(portalStore, sealer, {
    origins: [ORIGIN],
    secureCookies: false,
    attemptsPerIp: 1_000,
    now,
  });
  const passwordHash = await hashPassword(PASSWORD);
  const secrets: Record<string, string> = {};
  const addUser = (email: string, role: PortalRole, partnerSlug?: string) => {
    secrets[email] = newTotpSecret();
    portalStore.saveUser({
      id: `usr_${email.replace(/\W/g, "")}`,
      email,
      ...(partnerSlug ? { partnerSlug } : {}),
      role,
      passwordHash,
      totpSecretSealed: sealer.seal(secrets[email]!),
      status: "active",
      failedAttempts: 0,
      createdAt: START.toISOString(),
    });
  };
  addUser("viewer@bank.test", "viewer", "demo-bank");
  addUser("dev@bank.test", "developer", "demo-bank");
  addUser("comp@bank.test", "compliance", "demo-bank");
  addUser("comp@wallet.test", "compliance", "moher-wallet");
  addUser("ops@mohar.test", "operator");

  const partners = new PartnerDirectory(
    "mk_test_unit=demo-bank,mk_test_w=moher-wallet",
    "demo-bank=https://bank.example/hooks,moher-wallet=https://wallet.example/hooks",
    "demo-bank=whsec_bank_unit_test_secret,moher-wallet=whsec_wallet_unit_test_secret",
  );
  applyPortalSettings(partners, portalStore, sealer);
  const sent: Sent[] = [];
  const webhooks = new WebhookSender((t) => ({ id: t.id, status: t.status }), {
    recorder: portalStore,
    retryDelaysMs: [0],
    post: async (url, headers, body) => {
      sent.push({ url, headers, body });
      return { status: options.webhookStatus ?? 200 };
    },
  });

  const chain = {
    getChainId: async () => 31337,
    getBlockNumber: async () => 1n,
    isWalletActive: async () => true,
    isPartnerActive: async () => true,
    balanceOf: async () => 71_557_733n,
    latestReserve: async () => ({
      attestation: { totalGrams: 100n, asOf: 1_763_400_000n, nonce: 1n },
      tokenSupplyAtPublish: 100n,
      publishedAt: 1_763_400_000n,
    }),
    explorerTxUrl: () => undefined,
    explorerAddressUrl: () => undefined,
    deployment: { mockFeed: false },
  } as unknown as MoharChain;

  const ctx = {
    chain,
    store,
    queue: new SerialQueue(),
    partners,
    price: {
      current: async () => ({
        xauUsdE8: 388_442_000_000n,
        usdPkrE4: 2_790_500n,
        updatedAt: 1_763_400_000n,
        source: "mock",
      }),
    },
    portal: {
      store: portalStore,
      auth,
      manage: { sealer, webhooks, compliance: options.compliance, allowLoopbackWebhooks: false },
    },
    settings: {
      fees: { platformFeeBps: 50n, fxMarginBps: 25n },
      quoteTtlSeconds: 60,
      requestsPerMinute: 600,
      walletRegistrationsPerHour: 120,
      devRoutes: false,
      devPriceBandBps: 500n,
      kycLimits: parseKycLimits(DEFAULT_KYC_LIMITS),
    },
  } as unknown as AppContext;

  const app = createApp(ctx);
  const codeFor = (email: string) =>
    codeAt(secrets[email]!, counterAt(Math.floor(clock.now.getTime() / 1000)));

  /** Signs in and returns the cookie to send. Moves the clock 30 s so each code is fresh. */
  async function signIn(email: string): Promise<string> {
    clock.now = new Date(clock.now.getTime() + 30_000);
    const res = await request(app)
      .post("/portal/v1/session")
      .set("Origin", ORIGIN)
      .send({ email, password: PASSWORD, code: codeFor(email) });
    expect(res.status).toBe(200);
    return String(res.headers["set-cookie"]![0]).split(";")[0]!;
  }

  return { app, clock, ctx, store, portalStore, partners, sent, webhooks, codeFor, signIn };
}
