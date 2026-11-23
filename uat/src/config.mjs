// Where the run points: the local Anvil stack, or the Amoy deployment on this laptop.
// Secrets are read from the git-ignored .env files the apps already use, kept in memory only,
// and never written to the logs.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Reads KEY=VALUE lines from an env file (missing file: nothing). */
function envFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  return value === undefined || value.startsWith("--") ? true : value;
}

const target = arg("target", "local");
if (!["local", "amoy"].includes(target))
  throw new Error(`--target must be local or amoy, not ${target}`);

const apiEnv =
  target === "amoy" ? envFile(join(REPO, "api", ".env.amoy")) : envFile(join(REPO, "api", ".env"));
const bankEnv =
  target === "amoy"
    ? envFile(join(REPO, "demo-bank", ".env.amoy"))
    : envFile(join(REPO, "demo-bank", ".env.local"));
const walletEnv = target === "amoy" ? envFile(join(REPO, "demo-bank", ".env.amoy.wallet")) : {};

if (target === "amoy") {
  for (const [file, env, key] of [
    ["api/.env.amoy", apiEnv, "RPC_URL"],
    ["demo-bank/.env.amoy", bankEnv, "MOHAR_API_KEY"],
    ["demo-bank/.env.amoy.wallet", walletEnv, "MOHAR_API_KEY"],
  ]) {
    if (!env[key])
      throw new Error(
        `${file} has no ${key}. Run this on the laptop that holds the Amoy settings.`,
      );
  }
}

const chainId = target === "amoy" ? 80002 : 31337;
const apiDir = join(REPO, "api");
const dataDir = resolve(apiDir, process.env.UAT_DATA_DIR ?? apiEnv.DATA_DIR ?? ".data");
const port = Number(apiEnv.PORT ?? 4000);

export const config = {
  target,
  chainId,
  rounds: Number(arg("rounds", 5)),
  /** "full": every scenario every round (local). "light": every feature each round, fewer
   *  repeat trades and one freeze per partner overall, to save test POL (Amoy). */
  profile: arg("profile", target === "amoy" ? "light" : "full"),
  headed: arg("headed", target === "amoy") !== false && arg("headless", false) !== true,
  slowMo: Number(arg("slow", target === "amoy" ? 120 : 0)),
  api: (bankEnv.MOHAR_API_URL ?? `http://127.0.0.1:${port}`)
    .replace(/\/+$/, "")
    .replace("localhost", "127.0.0.1"),
  portalOrigin: "http://localhost:3002",
  rpcUrl: apiEnv.RPC_URL ?? "http://127.0.0.1:8545",
  deploymentFile: join(REPO, "contracts", "deployments", `${chainId}.json`),
  dataDir,
  /** Env for `pnpm --filter @mohar/api portal:user`, so it opens the same portal database and key. */
  cliEnv:
    target === "amoy"
      ? { DOTENV_CONFIG_PATH: ".env.amoy" }
      : { ...(process.env.UAT_DATA_DIR ? { DATA_DIR: dataDir } : {}) },
  explorer: target === "amoy" ? "https://amoy.polygonscan.com" : undefined,
  /** Only the address is kept: the key itself never leaves this function. */
  complianceAddress: apiEnv.COMPLIANCE_PRIVATE_KEY
    ? privateKeyToAccount(apiEnv.COMPLIANCE_PRIVATE_KEY).address
    : undefined,
  devKey: bankEnv.MOHAR_DEV_KEY ?? "mk_dev_local",
  apps: {
    bank: {
      base: "http://localhost:3000",
      slug: "demo-bank",
      apiKey: bankEnv.MOHAR_API_KEY ?? "mk_test_local",
      name: "MOHAR Bank",
      level: "standard",
      persona: { id: "hassan", name: "Hassan Raza" },
    },
    wallet: {
      base: "http://localhost:3001",
      slug: "moher-wallet",
      apiKey: walletEnv.MOHAR_API_KEY ?? "mk_test_wallet",
      name: "MOHAR Wallet",
      level: "asaan",
      persona: { id: "aliya", name: "Aliya Siddiqui" },
    },
  },
  // --out puts the run's folder somewhere else, e.g. /mnt/c/Users/<you>/Downloads/uat from WSL.
  out: resolve(
    typeof arg("out") === "string" ? arg("out") : join(REPO, "uat", "out"),
    `${target}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`,
  ),
};
