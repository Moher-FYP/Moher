import { MoharApiError, type Reserve, type ReserveProof } from "@mohar/sdk";
import { connection } from "next/server";
import { AppHeader } from "@/components/AppHeader";
import { Seal } from "@/components/Seal";
import { grams, shortHash, when } from "@/lib/format";
import { getMohar } from "@/lib/mohar";
import { requireCustomer, withWallet } from "@/lib/session";

async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof MoharApiError && error.code === "not_found") return null;
    throw error;
  }
}

export default async function Verify() {
  await connection();
  const customer = await requireCustomer();
  const [reserve, proof] = await Promise.all([
    orNull<Reserve>(getMohar().getReserve()),
    withWallet(customer, (walletId) => orNull<ReserveProof>(getMohar().getReserveProof(walletId))),
  ]);

  return (
    <>
      <AppHeader customer={customer} title="Your gold in the vault" backHref="/" />
      <section className="space-y-5 p-5">
        <div className="gold-card flex items-center gap-4 rounded-3xl p-5">
          <Seal size={64} />
          <div>
            {proof ? (
              <>
                <p className="font-display text-xl font-semibold">
                  {proof.verifiedOnChain ? "Your gold is accounted for" : "Not yet verified"}
                </p>
                <p className="text-sm opacity-80">
                  {grams(proof.grams)} held in your name
                  {proof.verifiedOnChain ? ", confirmed on the public ledger" : ""}
                </p>
              </>
            ) : (
              <>
                <p className="font-display text-xl font-semibold">Nothing to verify yet</p>
                <p className="text-sm opacity-80">Buy some gold and check back here.</p>
              </>
            )}
          </div>
        </div>

        {reserve ? (
          <div className="space-y-3">
            <h2 className="font-display text-lg font-semibold">The whole vault</h2>
            <dl className="divide-y divide-line rounded-2xl border border-line text-sm">
              <Row label="Gold in the vault" value={grams(reserve.totalGramsInVault)} />
              <Row label="Gold owned by customers" value={grams(reserve.tokenSupplyGrams)} />
              <Row
                label="Fully backed"
                value={reserve.fullyBacked ? "Yes" : "No — new purchases are paused"}
                strong
              />
              <Row label="Last checked" value={when(reserve.asOf)} />
              <Row label="Attestation" value={`#${reserve.nonce}`} />
              <Row label="Ledger record" value={shortHash(reserve.allocationsRoot)} mono />
            </dl>
          </div>
        ) : (
          <p className="text-ink-soft">
            The vault publishes its first attestation after the first purchase.
          </p>
        )}

        <details className="rounded-2xl bg-paper p-4 text-sm">
          <summary className="cursor-pointer font-semibold">How this check works</summary>
          <div className="mt-3 space-y-2 text-ink-soft">
            <p>
              After every trade the vault signs a statement of all the gold it holds and who it
              belongs to. That statement is published to a public ledger, where nobody — not the
              bank, not the vault — can change it afterwards.
            </p>
            <p>
              Your share is one entry in it. The check above asks the ledger itself whether your
              entry is included, so you don&apos;t have to take the bank&apos;s word for it.
            </p>
            <p>
              This meets the AAOIFI Shariah Standard 57 requirement that gold is fully allocated to
              its owner.
            </p>
          </div>
        </details>
      </section>
    </>
  );
}

function Row({
  label,
  value,
  strong,
  mono,
}: {
  label: string;
  value: string;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4 px-4 py-3">
      <dt className="text-ink-soft">{label}</dt>
      <dd
        className={`${strong ? "font-semibold text-bank" : "font-medium"} ${mono ? "font-mono" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
