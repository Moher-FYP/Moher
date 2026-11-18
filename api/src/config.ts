import "dotenv/config";
import { z } from "zod";
import { LOCAL_ONLY } from "./secrets.js";
import { DEFAULT_KYC_LIMITS } from "./domain/kyc-limits.js";

/**
 * API configuration. Every variable has a safe local default, so `pnpm --filter @mohar/api dev`
 * works against Anvil with no .env file. On any other chain the keys must be set explicitly
 * (enforced in bootstrap once the deployment's chain id is known).
 */
const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  /**
   * The network interface to listen on. The default accepts connections from this machine
   * only. Set 0.0.0.0 on a server, behind a proxy that provides HTTPS.
   */
  HOST: z.string().min(1).default("127.0.0.1"),
  RPC_URL: z.string().url().default("http://127.0.0.1:8545"),
  DEPLOYMENT_FILE: z.string().default("../contracts/deployments/31337.json"),

  RELAYER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  VAULT_SIGNER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  /**
   * The compliance key: freezes and unfreezes wallets an operator approves in the portal, and
   * nothing else. Must hold COMPLIANCE_ROLE on the WalletRegistry. Local Anvil uses account #3,
   * which the deploy script grants. Without it, freeze requests can be made but not carried out.
   */
  COMPLIANCE_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  /** Custodial customer wallets are derived from this mnemonic (m/44'/60'/1'/0/i). */
  WALLET_MNEMONIC: z.string().optional(),

  /**
   * Keys the KYC fingerprint written on-chain with each wallet (domain/kyc.ts). Keep it for as
   * long as wallets exist: without it a fingerprint can no longer be matched to a reference.
   */
  KYC_HASH_SECRET: z.string().min(8).optional(),
  USD_PKR_RATE: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .default("279.05"),
  /**
   * What a customer may receive (buy, or be sent) at each KYC level, in PKR:
   * `level=perTrade:per24Hours:per30Days:maxHolding`, comma-separated. The defaults follow the
   * State Bank's account levels (src/domain/kyc-limits.ts); each partner confirms its own.
   */
  KYC_LIMITS: z.string().default(DEFAULT_KYC_LIMITS),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(1_000).default(50),
  FX_MARGIN_BPS: z.coerce.number().int().min(0).max(25).default(25),
  QUOTE_TTL_SECONDS: z.coerce.number().int().min(10).max(600).default(60),

  /**
   * Comma-separated `apiKey=partnerSlug` pairs. The default is public (it is in this repo), so
   * bootstrap refuses it on any chain but local Anvil — see secrets.ts.
   */
  PARTNER_API_KEYS: z.string().default(LOCAL_ONLY.partnerApiKeys),
  /** Comma-separated `partnerSlug=https://...` pairs. */
  PARTNER_WEBHOOK_URLS: z
    .string()
    .default(
      "demo-bank=http://localhost:3000/api/mohar/webhooks,moher-wallet=http://localhost:3001/api/mohar/webhooks",
    ),
  /**
   * Comma-separated `partnerSlug=secret` pairs: each partner's own webhook signing secret, so
   * one partner cannot forge an event to another. Required off local Anvil.
   */
  PARTNER_WEBHOOK_SECRETS: z.string().default(""),
  /** Local Anvil only: signs webhooks for partners with no entry in PARTNER_WEBHOOK_SECRETS. */
  WEBHOOK_SECRET: z.string().min(8).default(LOCAL_ONLY.webhookSecret),

  /**
   * Testnet only: make the mock gold feed follow a real Chainlink XAU/USD feed on another
   * chain (Polygon mainnet). Set both or neither. Reading that feed costs nothing.
   */
  MIRROR_RPC_URL: z.string().url().optional(),
  MIRROR_FEED_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  /** Copy the reference once it differs from the mock by this much (20 = 0.20%). */
  MIRROR_MIN_MOVE_BPS: z.coerce.number().int().min(1).max(500).default(20),
  MIRROR_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3_600).default(120),
  /** After a manual /dev/price move, the mirror waits this long before taking over again. */
  MIRROR_HOLD_SECONDS: z.coerce.number().int().min(0).max(86_400).default(600),
  /** Ignore a reference older than this. Four days covers a weekend plus a market holiday. */
  MIRROR_MAX_AGE_SECONDS: z.coerce.number().int().min(60).default(345_600),

  /**
   * Least seconds between two reserve proofs. 0 (default): one proof after each burst of
   * trades, as soon as the relayer is free. 60 on a busy chain: at most one a minute, which
   * roughly halves the gas of a trade; a wallet's proof then lags its trade by up to a minute.
   */
  RESERVE_PUBLISH_INTERVAL_SECONDS: z.coerce.number().int().min(0).max(3_600).default(0),
  /** Requests each partner may send per minute, across all routes. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(600),
  /** New customer wallets each partner may register per hour. Each one costs the relayer gas. */
  WALLET_REGISTRATIONS_PER_HOUR: z.coerce.number().int().min(1).default(120),
  /**
   * Where the partner portal is served from, comma-separated. Sign-ins and changes from any
   * other origin are refused. The portal's cookie is marked Secure unless every origin is
   * http://localhost.
   */
  PORTAL_ORIGINS: z.string().default("http://localhost:3002"),
  /**
   * Seals each portal user's authenticator secret in the data file. Local Anvil falls back to
   * a public default; elsewhere it must be set (openssl rand -hex 32).
   */
  PORTAL_SECRET_KEY: z.string().min(16).optional(),
  /**
   * Allow webhooks to http://localhost (the demo apps run there). Defaults to on for local
   * Anvil, off elsewhere; set true for the Amoy demo, where the partner apps are still local.
   * Private, link-local and other internal addresses are refused either way.
   */
  WEBHOOK_ALLOW_LOCALHOST: z.enum(["true", "false"]).optional(),
  /**
   * Which proxies may tell the API the client's real address (X-Forwarded-For), in Express's
   * "trust proxy" form. Default "loopback": the partner portal on this machine passes portal
   * requests through, and the API listens on 127.0.0.1, so only local processes can set it.
   * Use "false" if the API is ever exposed directly.
   */
  TRUST_PROXY: z.string().default("loopback"),
  /**
   * Hours between on-chain anchors of the portal's audit and security logs (portal/anchor.ts),
   * sent from the compliance key. 0 turns anchoring off. About 0.0007 POL each on Amoy.
   */
  AUDIT_ANCHOR_HOURS: z.coerce.number().min(0).max(168).default(24),
  /** Where the JSON store lives. ":memory:" keeps everything in memory (tests). */
  DATA_DIR: z.string().default(".data"),
  /** Enables /dev routes (move the mock gold price). Defaults to on for local chains. */
  ENABLE_DEV_ROUTES: z.enum(["true", "false"]).optional(),
  /**
   * The operator key for /dev routes. Partner keys cannot move the price. Local Anvil falls
   * back to a public default; elsewhere it must be set when ENABLE_DEV_ROUTES=true.
   */
  DEV_API_KEY: z.string().min(8).optional(),
  /** A manual price must stay within this distance of the reference price (500 = 5%). */
  DEV_PRICE_BAND_BPS: z.coerce.number().int().min(1).max(1_000).default(500),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // A line left blank in .env ("RELAYER_PRIVATE_KEY=") means "not set", not an empty value.
  const set = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
  const parsed = ConfigSchema.safeParse(set);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid API configuration:\n  ${issues.join("\n  ")}`);
  }
  return parsed.data;
}

/**
 * Anvil's public development accounts — the same ones contracts/script/Deploy.s.sol assigns
 * (#1 relayer, #2 vault). Known to everyone; used only when the chain is Anvil.
 */
export const ANVIL_DEFAULTS = {
  chainId: 31337,
  relayerPrivateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  vaultSignerPrivateKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  walletMnemonic: "test test test test test test test test test test test junk",
  /** Account #3, granted COMPLIANCE_ROLE by the deploy script on Anvil. */
  compliancePrivateKey: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const;
