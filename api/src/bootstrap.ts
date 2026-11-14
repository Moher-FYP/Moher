import { join } from "node:path";
import type { Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { loadDeployment } from "./chain/deployment.js";
import type { Deployment } from "./chain/deployment.js";
import { MoharChain } from "./chain/mohar-chain.js";
import { ChainlinkReferenceFeed } from "./chain/reference-feed.js";
import { ANVIL_DEFAULTS, type Config } from "./config.js";
import type { AppContext } from "./context.js";
import { PartnerDirectory } from "./http/auth.js";
import { toApiTransaction } from "./http/presenters.js";
import { SerialQueue } from "./lib/queue.js";
import { PriceService, type MirrorOptions } from "./services/price.js";
import { SettlementService } from "./services/settlement.js";
import { WebhookSender } from "./services/webhooks.js";
import { Store } from "./store/store.js";
import { MockVault } from "./vault/mock-vault.js";

/**
 * Wires the API: reads the deployment, checks keys match the roles granted on-chain, restores
 * the JSON store and the vault's allocation book, and starts the mock price keeper (which
 * mirrors a real XAU/USD feed when MIRROR_* is set).
 */
export async function bootstrap(config: Config): Promise<AppContext> {
  const deployment = loadDeployment(config.DEPLOYMENT_FILE);
  const local = deployment.chainId === ANVIL_DEFAULTS.chainId;

  const relayerKey = keyOrDefault(
    config.RELAYER_PRIVATE_KEY,
    local && ANVIL_DEFAULTS.relayerPrivateKey,
    "RELAYER_PRIVATE_KEY",
  );
  const vaultKey = keyOrDefault(
    config.VAULT_SIGNER_PRIVATE_KEY,
    local && ANVIL_DEFAULTS.vaultSignerPrivateKey,
    "VAULT_SIGNER_PRIVATE_KEY",
  );
  const mnemonic = config.WALLET_MNEMONIC ?? (local ? ANVIL_DEFAULTS.walletMnemonic : undefined);
  if (!mnemonic) throw new Error("WALLET_MNEMONIC is required outside local Anvil");

  const chain = new MoharChain(deployment, config.RPC_URL, relayerKey);
  const rpcChainId = await chain.getChainId().catch(() => {
    throw new Error(`Cannot reach the chain at ${config.RPC_URL}. Is \`pnpm chain\` running?`);
  });
  if (rpcChainId !== deployment.chainId) {
    throw new Error(
      `RPC is chain ${rpcChainId} but ${config.DEPLOYMENT_FILE} is for chain ${deployment.chainId}`,
    );
  }
  if (!(await chain.hasCode(deployment.moharToken))) {
    throw new Error(
      "Contracts are not deployed on this chain. Run: pnpm contracts:deploy:local (after pnpm chain)",
    );
  }
  if (chain.relayer.address !== deployment.relayer) {
    throw new Error(
      `RELAYER_PRIVATE_KEY is ${chain.relayer.address}, but the contracts trust ${deployment.relayer}`,
    );
  }

  const vault = new MockVault(vaultKey, deployment);
  if (vault.address !== deployment.vaultSigner) {
    throw new Error(
      `VAULT_SIGNER_PRIVATE_KEY is ${vault.address}, but the contracts trust ${deployment.vaultSigner}`,
    );
  }

  const store = new Store(
    config.DATA_DIR === ":memory:"
      ? null
      : join(config.DATA_DIR, `store-${deployment.chainId}.json`),
  );
  const { reset } = store.open(await chain.chainMarker());
  if (reset) console.log("Started a fresh store for this chain.");

  // Rebuild the vault's allocation book from on-chain balances of known wallets.
  const holdings = await Promise.all(
    store.allWallets().map(async (w) => [w.address, await chain.balanceOf(w.address)] as const),
  );
  const latest = await chain.latestReserve();
  vault.load(holdings, latest?.attestation.nonce ?? 0n, latest?.attestation.asOf ?? 0n);

  const queue = new SerialQueue();
  const mirror = await mirrorOptions(config, deployment);
  const price = new PriceService(chain, queue, toE4(config.USD_PKR_RATE), mirror);
  const webhooks = new WebhookSender(config.WEBHOOK_SECRET, (txn) =>
    toApiTransaction(txn, (h) => chain.explorerTxUrl(h)),
  );
  const settlement = new SettlementService(chain, vault, store, queue, webhooks);
  if (mirror) await price.tick(); // start from the market price, not the deploy-time one
  price.startKeeper();

  return {
    chain,
    store,
    vault,
    price,
    settlement,
    partners: new PartnerDirectory(config.PARTNER_API_KEYS, config.PARTNER_WEBHOOK_URLS),
    queue,
    deriveWalletAddress: (index) =>
      mnemonicToAccount(mnemonic, { accountIndex: 1, addressIndex: index }).address,
    settings: {
      fees: {
        platformFeeBps: BigInt(config.PLATFORM_FEE_BPS),
        fxMarginBps: BigInt(config.FX_MARGIN_BPS),
      },
      quoteTtlSeconds: config.QUOTE_TTL_SECONDS,
      devRoutes: config.ENABLE_DEV_ROUTES ? config.ENABLE_DEV_ROUTES === "true" : local,
    },
  };
}

/** Builds the price mirror when MIRROR_* is configured; checks the reference feed is gold. */
async function mirrorOptions(
  config: Config,
  deployment: Deployment,
): Promise<MirrorOptions | undefined> {
  const { MIRROR_RPC_URL: rpcUrl, MIRROR_FEED_ADDRESS: address } = config;
  if (!rpcUrl && !address) return undefined;
  if (!rpcUrl || !address) {
    throw new Error("Set both MIRROR_RPC_URL and MIRROR_FEED_ADDRESS, or neither");
  }
  if (!deployment.mockFeed) {
    throw new Error(
      "MIRROR_* is set, but this deployment reads a real price feed. Remove MIRROR_RPC_URL and MIRROR_FEED_ADDRESS.",
    );
  }
  const feed = new ChainlinkReferenceFeed(
    rpcUrl,
    address as Hex,
    BigInt(config.MIRROR_MAX_AGE_SECONDS),
  );
  const description = await feed.verify().catch((error: unknown) => {
    throw new Error(`Cannot use the mirror feed at ${rpcUrl}: ${errorMessage(error)}`);
  });
  console.log(`The mock gold price mirrors "${description}" (${address}).`);
  return {
    feed,
    minMoveBps: BigInt(config.MIRROR_MIN_MOVE_BPS),
    intervalSeconds: config.MIRROR_INTERVAL_SECONDS,
    holdSeconds: config.MIRROR_HOLD_SECONDS,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function keyOrDefault(value: string | undefined, fallback: string | false, name: string): Hex {
  const key = value ?? (fallback || undefined);
  if (!key) throw new Error(`${name} is required outside local Anvil`);
  return key as Hex;
}

/** "279.05" -> 2790500n */
function toE4(rate: string): bigint {
  const [whole = "0", fraction = ""] = rate.split(".");
  return BigInt(whole + fraction.padEnd(4, "0"));
}
