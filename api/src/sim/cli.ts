import { createConnection } from "node:net";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { generatePrivateKey } from "viem/accounts";
import { loadDeployment } from "../chain/deployment.js";
import { MoharChain } from "../chain/mohar-chain.js";
import { loadConfig } from "../config.js";
import { parseKycLimits } from "../domain/kyc-limits.js";
import { Store } from "../store/store.js";
import { isSimulatedPartner, simulateHistory, SIMULATED_PREFIX } from "./simulate.js";

/**
 * Writes a simulated history for a "sim-" partner into the API's store, so the portal's
 * overview and trading pages have months of activity to show. Run it with the chain up and
 * the API stopped (the API keeps the store in memory and would overwrite the change):
 *
 *   pnpm --filter @mohar/api simulate --partner sim-bank
 *   pnpm --filter @mohar/api simulate --partner sim-bank --savers 300 --days 90 --seed 7
 *   pnpm --filter @mohar/api simulate --partner sim-bank --clear
 *
 * Then add a portal viewer for it and sign in:
 *   pnpm --filter @mohar/api portal:user add --email sim@demo.test --role viewer --partner sim-bank
 *
 * The records are marked simulated, never touch the chain, and are refused for a partner
 * that has any real record. Restarting Anvil empties the store, simulation included.
 */

const { values } = parseArgs({
  options: {
    partner: { type: "string", default: "sim-bank" },
    savers: { type: "string", default: "200" },
    days: { type: "string", default: "90" },
    seed: { type: "string", default: "1" },
    clear: { type: "boolean", default: false },
  },
});

const config = loadConfig();

async function main(): Promise<void> {
  const partner = values.partner!;
  if (!isSimulatedPartner(partner)) {
    fail(`The partner's slug must start with "${SIMULATED_PREFIX}" (e.g. sim-bank)`);
  }
  const savers = positive("savers", values.savers!, 5_000);
  const days = positive("days", values.days!, 365);
  const seed = positive("seed", values.seed!, 2 ** 31);
  if (await apiIsRunning()) {
    fail(
      `The API is running on port ${config.PORT}. Stop it first: it keeps the store in memory ` +
        "and would overwrite this change when it next saves.",
    );
  }
  if (config.DATA_DIR === ":memory:") fail("DATA_DIR is :memory:, so there is no store to write");

  const deployment = loadDeployment(config.DEPLOYMENT_FILE);
  if (deployment.chainId !== 31337) {
    fail("Simulated history is for the local demo only (chain 31337), never a shared testnet");
  }
  // A throwaway key: this script only reads the chain.
  const chain = new MoharChain(deployment, config.RPC_URL, generatePrivateKey());
  const marker = await chain.chainMarker().catch(() => {
    fail(`Cannot reach the chain at ${config.RPC_URL}. Is \`pnpm chain\` running?`);
  });
  const store = new Store(join(config.DATA_DIR, `store-${deployment.chainId}.json`));
  store.open(marker);

  const removed = store.clearSimulated(partner);
  if (removed > 0) console.log(`Removed ${removed} earlier simulated records for ${partner}.`);
  if (values.clear) return;

  const { xauUsdE8 } = await chain.latestPrice();
  const [whole = "0", fraction = ""] = config.USD_PKR_RATE.split(".");
  const history = simulateHistory({
    partner,
    savers,
    days,
    seed,
    now: new Date(),
    endPrice: { xauUsdE8, usdPkrE4: BigInt(whole + fraction.padEnd(4, "0")) },
    fees: {
      platformFeeBps: BigInt(config.PLATFORM_FEE_BPS),
      fxMarginBps: BigInt(config.FX_MARGIN_BPS),
    },
    limits: parseKycLimits(config.KYC_LIMITS),
  });
  store.addSimulated(history);
  console.log(
    `Simulated ${history.wallets.length} savers, ${history.quotes.length} quotes and ` +
      `${history.transactions.length} trades over ${days} days for ${partner} (seed ${seed}).`,
  );
  console.log(
    `Portal viewer: pnpm --filter @mohar/api portal:user add --email you@${partner}.test --role viewer --partner ${partner}`,
  );
}

function positive(name: string, text: string, max: number): number {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > max) fail(`--${name}: a whole number from 1 to ${max}`);
  return n;
}

function apiIsRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: config.HOST, port: config.PORT });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
