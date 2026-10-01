import type { Address } from "viem";
import type { MoharChain } from "./chain/mohar-chain.js";
import type { FeeRates } from "./domain/pricing.js";
import type { PartnerDirectory } from "./http/auth.js";
import type { SerialQueue } from "./lib/queue.js";
import type { PriceService } from "./services/price.js";
import type { SettlementService } from "./services/settlement.js";
import type { Store } from "./store/store.js";
import type { MockVault } from "./vault/mock-vault.js";

/** Everything route handlers need. Built once in bootstrap.ts; tests can pass fakes. */
export interface AppContext {
  chain: MoharChain;
  store: Store;
  vault: MockVault;
  price: PriceService;
  settlement: SettlementService;
  partners: PartnerDirectory;
  /** The relayer queue: every on-chain write goes through it. */
  queue: SerialQueue;
  /** Custodial address for the n-th customer wallet. */
  deriveWalletAddress: (index: number) => Address;
  settings: {
    fees: FeeRates;
    quoteTtlSeconds: number;
    devRoutes: boolean;
  };
}
