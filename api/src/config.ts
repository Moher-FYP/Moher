import "dotenv/config";
import { z } from "zod";

/**
 * API configuration. Every variable has a safe local default, so `pnpm --filter @mohar/api dev`
 * works against Anvil with no .env file. On any other chain the keys must be set explicitly
 * (enforced in bootstrap once the deployment's chain id is known).
 */
const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
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
  /** Custodial customer wallets are derived from this mnemonic (m/44'/60'/1'/0/i). */
  WALLET_MNEMONIC: z.string().optional(),

  USD_PKR_RATE: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .default("279.05"),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(1_000).default(50),
  FX_MARGIN_BPS: z.coerce.number().int().min(0).max(25).default(25),
  QUOTE_TTL_SECONDS: z.coerce.number().int().min(10).max(600).default(60),

  /** Comma-separated `apiKey=partnerSlug` pairs. */
  PARTNER_API_KEYS: z.string().default("mk_test_local=demo-bank"),
  /** Comma-separated `partnerSlug=https://...` pairs. */
  PARTNER_WEBHOOK_URLS: z.string().default(""),
  WEBHOOK_SECRET: z.string().min(8).default("whsec_local_dev_only"),

  /** Where the JSON store lives. ":memory:" keeps everything in memory (tests). */
  DATA_DIR: z.string().default(".data"),
  /** Enables /dev routes (move the mock gold price). Defaults to on for local chains. */
  ENABLE_DEV_ROUTES: z.enum(["true", "false"]).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
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
} as const;
