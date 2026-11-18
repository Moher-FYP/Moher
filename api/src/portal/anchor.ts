import { hexToString, isHex, stringToHex, type Address, type Hex } from "viem";
import type { AnchorRecord, PortalStore } from "./portal-store.js";

/**
 * Anchors the portal's two logs on-chain. Each log is a hash chain, so editing or deleting an
 * entry breaks it; but someone who can rewrite the whole file could recompute every hash. Once
 * a day (and on demand) the latest seq and hash of each log go into a transaction that MOHAR
 * cannot change afterwards. Checking a log against those transactions catches a rewrite of any
 * entry at or before the last anchor.
 *
 * The transaction is a self-transfer of zero from the compliance key, with the text
 *   MOHAR audit v1|audit:<seq>:<hash>|security:<seq>:<hash>
 * as its data: about 24,000 gas, roughly 0.0007 POL a day on Amoy at 30 gwei.
 */

export interface AnchorSigner {
  readonly address: Address;
  anchor(data: Hex): Promise<Hex>;
  transactionData(
    hash: Hex,
  ): Promise<{ from: Address; to: Address | null; input: Hex } | undefined>;
}

export interface AnchorCheck {
  /** Anchors checked against the chain and the log. */
  anchors: number;
  /** Every anchored entry still has the hash written on-chain. */
  intact: boolean;
  lastAnchoredAt?: string;
  lastTxHash?: string;
  /** What did not match, if anything. */
  problem?: string;
}

const PREFIX = "MOHAR audit v1";

export function anchorText(a: Pick<AnchorRecord, "audit" | "security">): string {
  return `${PREFIX}|audit:${a.audit.seq}:${a.audit.hash}|security:${a.security.seq}:${a.security.hash}`;
}

export class AuditAnchor {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly store: PortalStore,
    private readonly signer: AnchorSigner,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Writes the logs' current heads on-chain, unless nothing changed since the last anchor. */
  async anchorNow(): Promise<AnchorRecord | undefined> {
    const audit = this.store.head("audit");
    const security = this.store.head("security");
    if (audit.seq === 0 && security.seq === 0) return undefined; // nothing logged yet
    const last = this.store.anchors().at(-1);
    if (last && last.audit.seq === audit.seq && last.security.seq === security.seq) {
      return undefined;
    }
    const txHash = await this.signer.anchor(stringToHex(anchorText({ audit, security })));
    const record: AnchorRecord = { at: this.now().toISOString(), audit, security, txHash };
    this.store.saveAnchor(record);
    return record;
  }

  /** Anchors now if the last anchor is older than the interval, then every interval. */
  start(intervalHours: number): void {
    if (this.timer || intervalHours <= 0) return;
    const tick = () =>
      void this.anchorNow().catch((error: unknown) =>
        console.error("Audit anchor failed:", error instanceof Error ? error.message : error),
      );
    const last = this.store.anchors().at(-1);
    const due = !last || this.now().getTime() - Date.parse(last.at) >= intervalHours * 3_600_000;
    if (due) tick();
    this.timer = setInterval(tick, intervalHours * 3_600_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Checks every anchor: the transaction exists, came from the compliance key to itself, says
   * what MOHAR recorded, and the log still holds that hash at that seq. Entries capped away
   * since are skipped.
   */
  async verify(): Promise<AnchorCheck> {
    const anchors = this.store.anchors();
    const last = anchors.at(-1);
    const base = {
      anchors: anchors.length,
      ...(last ? { lastAnchoredAt: last.at, lastTxHash: last.txHash } : {}),
    };
    for (const a of anchors) {
      const onChain = await this.signer.transactionData(a.txHash as Hex);
      if (!onChain)
        return { ...base, intact: false, problem: `Anchor ${a.txHash} is not on the chain` };
      const self = this.signer.address.toLowerCase();
      if (onChain.from.toLowerCase() !== self || onChain.to?.toLowerCase() !== self) {
        return {
          ...base,
          intact: false,
          problem: `Anchor ${a.txHash} was not sent by the compliance key`,
        };
      }
      const text = isHex(onChain.input) ? hexToString(onChain.input) : "";
      if (text !== anchorText(a)) {
        return {
          ...base,
          intact: false,
          problem: `Anchor ${a.txHash} does not say what the file records`,
        };
      }
      for (const name of ["audit", "security"] as const) {
        const { seq, hash } = a[name];
        if (seq === 0) continue;
        const entry = this.store.entry(name, seq);
        if (entry && entry.hash !== hash) {
          return {
            ...base,
            intact: false,
            problem: `The ${name} log's entry ${seq} differs from what was anchored at ${a.at}`,
          };
        }
      }
    }
    return { ...base, intact: true };
  }
}
