import { join } from "node:path";
import type { Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { loadDeployment } from "./chain/deployment.js";
import type { Deployment } from "./chain/deployment.js";
import { MoharChain } from "./chain/mohar-chain.js";
import { ChainlinkReferenceFeed } from "./chain/reference-feed.js";
import { ANVIL_DEFAULTS, type Config } from "./config.js";
import type { AppContext } from "./context.js";
import { kycFingerprint } from "./domain/kyc.js";
import { parseKycLimits } from "./domain/kyc-limits.js";
import { PartnerDirectory } from "./http/auth.js";
import { toApiTransaction } from "./http/presenters.js";
import { ComplianceSigner } from "./chain/compliance.js";
import { PortalAuth } from "./portal/auth.js";
import { applyPortalSettings } from "./portal/keys.js";
import { PortalStore } from "./portal/portal-store.js";
import { Sealer } from "./portal/sealed.js";
import { findWeakSecrets, LOCAL_ONLY } from "./secrets.js";
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

  // The repo's default API key, webhook secret and operator key are public. Off local Anvil,
  // refuse to start with them (or with anything short or shared) before touching the chain.
  const partners = new PartnerDirectory(
    config.PARTNER_API_KEYS,
    config.PARTNER_WEBHOOK_URLS,
    config.PARTNER_WEBHOOK_SECRETS,
    config.WEBHOOK_SECRET,
  );
  const devRoutes = config.ENABLE_DEV_ROUTES ? config.ENABLE_DEV_ROUTES === "true" : local;
  const devApiKey = config.DEV_API_KEY ?? (local ? LOCAL_ONLY.devApiKey : undefined);
  const kycHashSecret = config.KYC_HASH_SECRET ?? (local ? LOCAL_ONLY.kycHashSecret : undefined);
  const portalSecretKey =
    config.PORTAL_SECRET_KEY ?? (local ? LOCAL_ONLY.portalSecretKey : undefined);
  if (!local) {
    const problems = findWeakSecrets({
      apiKeys: partners.apiKeys(),
      partners: partners.all(),
      devApiKey,
      devRoutes,
      kycHashSecret,
      portalSecretKey,
    });
    if (problems.length > 0) {
      throw new Error(
        `These secrets are not safe outside local Anvil:\n  - ${problems.join("\n  - ")}\n  Generate each with: openssl rand -hex 24`,
      );
    }
  }

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

  // The partner portal: its own store (users, keys, logs, deliveries), and settings partners
  // changed there, applied over the start-up configuration before anything is sent.
  const portalOrigins = config.PORTAL_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const portalStore = new PortalStore(
    config.DATA_DIR === ":memory:" ? null : join(config.DATA_DIR, "portal.json"),
  );
  const sealer = new Sealer(portalSecretKey ?? LOCAL_ONLY.portalSecretKey);
  applyPortalSettings(partners, portalStore, sealer);
  const allowLoopbackWebhooks = config.WEBHOOK_ALLOW_LOCALHOST
    ? config.WEBHOOK_ALLOW_LOCALHOST === "true"
    : local;

  const queue = new SerialQueue();
  const webhooks = new WebhookSender(
    (txn) => toApiTransaction(txn, (h) => chain.explorerTxUrl(h)),
    { allowLoopback: allowLoopbackWebhooks, recorder: portalStore },
  );
  const settlement = new SettlementService(chain, vault, store, queue, webhooks);

  // Finish what the previous run left unfinished, before the vault book is read and before
  // any request is served.
  const cleared = store.clearInProgressIdempotency();
  const recovered = await settlement.recover((slug) => partners.get(slug));
  if (cleared + recovered.confirmed + recovered.failed + recovered.stillWaiting > 0) {
    console.log(
      `Recovered after restart: ${recovered.confirmed} confirmed, ${recovered.failed} failed, ` +
        `${recovered.stillWaiting} still waiting, ${cleared} interrupted request(s) cleared.`,
    );
  }

  // Rebuild the vault's allocation book from on-chain balances of known wallets.
  const holdings = await Promise.all(
    store.allWallets().map(async (w) => [w.address, await chain.balanceOf(w.address)] as const),
  );
  const latest = await chain.latestReserve();
  vault.load(holdings, latest?.attestation.nonce ?? 0n, latest?.attestation.asOf ?? 0n);
  if (recovered.confirmed > 0) {
    // A recovered trade changed the supply after the last reserve proof was published.
    await queue
      .run(() => settlement.publishReserve())
      .catch((error: unknown) => console.error("Reserve publish failed:", errorMessage(error)));
  }

  // A partner whose id the WalletRegistry does not know cannot register customers: every
  // registration would revert. Say so at start-up, with the fix, rather than on first use.
  for (const partner of partners.all()) {
    if (!(await chain.isPartnerActive(partner.partnerId))) {
      console.warn(
        `Partner "${partner.slug}" is not registered on-chain, so its customers cannot open wallets.\n` +
          `  The admin registers it with:\n` +
          `  cast send ${deployment.walletRegistry} "registerPartner(bytes32)" ${partner.partnerId} --rpc-url <RPC> --private-key <admin key>`,
      );
    }
  }

  const mirror = await mirrorOptions(config, deployment);
  const price = new PriceService(chain, queue, toE4(config.USD_PKR_RATE), mirror);
  if (mirror) await price.tick(); // start from the market price, not the deploy-time one
  price.startKeeper();

  const compliance = await complianceSigner(config, deployment, local);
  const portal = {
    store: portalStore,
    auth: new PortalAuth(portalStore, sealer, {
      origins: portalOrigins,
      secureCookies: !portalOrigins.every((o) => o.startsWith("http://localhost")),
    }),
    manage: { sealer, webhooks, compliance, allowLoopbackWebhooks },
  };

  return {
    chain,
    store,
    portal,
    vault,
    price,
    settlement,
    partners,
    queue,
    deriveWalletAddress: (index) =>
      mnemonicToAccount(mnemonic, { accountIndex: 1, addressIndex: index }).address,
    kycFingerprint: (partnerSlug, reference) =>
      kycFingerprint(kycHashSecret ?? LOCAL_ONLY.kycHashSecret, partnerSlug, reference),
    settings: {
      kycLimits: parseKycLimits(config.KYC_LIMITS),
      fees: {
        platformFeeBps: BigInt(config.PLATFORM_FEE_BPS),
        fxMarginBps: BigInt(config.FX_MARGIN_BPS),
      },
      quoteTtlSeconds: config.QUOTE_TTL_SECONDS,
      requestsPerMinute: config.RATE_LIMIT_PER_MINUTE,
      walletRegistrationsPerHour: config.WALLET_REGISTRATIONS_PER_HOUR,
      devRoutes,
      devApiKey,
      devPriceBandBps: BigInt(config.DEV_PRICE_BAND_BPS),
    },
  };
}

/**
 * The compliance key, if there is one and it holds COMPLIANCE_ROLE. Without it the portal still
 * records freeze requests; an operator just cannot carry them out.
 */
async function complianceSigner(
  config: Config,
  deployment: Deployment,
  local: boolean,
): Promise<ComplianceSigner | undefined> {
  const key =
    config.COMPLIANCE_PRIVATE_KEY ?? (local ? ANVIL_DEFAULTS.compliancePrivateKey : undefined);
  if (!key) {
    console.warn("No COMPLIANCE_PRIVATE_KEY: portal freeze requests cannot be carried out.");
    return undefined;
  }
  const signer = new ComplianceSigner(deployment, config.RPC_URL, key as Hex);
  if (signer.address === deployment.relayer) {
    throw new Error("COMPLIANCE_PRIVATE_KEY must not be the relayer's key");
  }
  if (!(await signer.hasRole())) {
    console.warn(
      `The compliance key ${signer.address} does not hold COMPLIANCE_ROLE, so freezes cannot be carried out.\n` +
        `  The admin grants it with:\n` +
        `  cast send ${deployment.walletRegistry} "grantRole(bytes32,address)" $(cast keccak COMPLIANCE_ROLE) ${signer.address} --rpc-url <RPC> --private-key <admin key>`,
    );
    return undefined;
  }
  return signer;
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
