import { MoharApiError, type Reserve, type ReserveProof } from "@mohar/sdk";
import { connection } from "next/server";
import { BackHeader, Chip, Panel, RoundIcon, Rows, SectionTitle } from "@/components/kit";
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
  const vault = reserve ? Number(reserve.totalGramsInVault) : 0;
  const owned = reserve ? Number(reserve.tokenSupplyGrams) : 0;
  const backing = owned > 0 ? (vault / owned) * 100 : 100;

  return (
    <>
      <BackHeader title="Gold in the vault" backHref="/" />
      <div className="flex flex-col gap-3.5 px-5 pt-2 pb-7">
        <section
          className={`rounded-[28px] px-5 pt-5 pb-[18px] ${proof?.verifiedOnChain ? "bg-sage" : "bg-sand"}`}
        >
          <div className="flex items-center gap-3">
            <RoundIcon
              name={proof?.verifiedOnChain ? "shield" : "clock"}
              tone="bg-white/80 text-ok"
              size={46}
            />
            <h2 className="font-display text-[23px] leading-[1.1] font-extrabold tracking-[-0.03em]">
              {proof
                ? proof.verifiedOnChain
                  ? `Your ${grams(proof.grams)} is accounted for`
                  : "Not yet verified"
                : "Nothing to verify yet"}
            </h2>
          </div>
          <p className="mt-3 text-[14.5px] leading-normal text-[#33402f]">
            {proof
              ? proof.verifiedOnChain
                ? "Every gram is allocated in your name and included in the vault's signed statement."
                : "Your grams are allocated; the vault's next signed statement will include them."
              : "Buy some gold and check back here."}
          </p>
          {proof?.verifiedOnChain && reserve ? (
            <p className="mt-3">
              <Chip tone="bg-white/80 text-ok">
                Checked against the public ledger · {when(reserve.asOf)}
              </Chip>
            </p>
          ) : null}
        </section>

        {reserve ? (
          <>
            <SectionTitle>The whole vault</SectionTitle>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                ["Gold in the vault", grams(reserve.totalGramsInVault)],
                ["Owned by customers", grams(reserve.tokenSupplyGrams)],
              ].map(([k, v]) => (
                <Panel key={k} className="px-4 py-3.5">
                  <p className="text-[13px] text-ink-soft">{k}</p>
                  <p className="mt-1.5 font-display text-[19px] font-extrabold tracking-[-0.02em]">
                    {v}
                  </p>
                </Panel>
              ))}
            </div>
            <Panel className="px-[18px] py-4">
              <div className="flex justify-between text-[13px] font-bold">
                <span>Backing</span>
                <span className={reserve.fullyBacked ? "text-ok" : "text-danger"}>
                  {backing.toFixed(2)}%
                </span>
              </div>
              <div
                role="meter"
                aria-label="Backing"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, Math.round(backing))}
                className={`mt-2 h-2.5 overflow-hidden rounded-[10px] ${reserve.fullyBacked ? "bg-ok-pale" : "bg-danger-pale"}`}
              >
                <span
                  className={`block h-full rounded-[10px] ${reserve.fullyBacked ? "bg-ok" : "bg-danger"}`}
                  style={{ width: `${Math.min(100, backing)}%` }}
                />
              </div>
              <p className="mt-2 text-[12.5px] text-ink-soft">
                {reserve.fullyBacked
                  ? "New purchases stop automatically if this ever drops below 100%. Selling always stays open."
                  : "Below 100%: new purchases are paused until the vault is reconciled. Selling stays open."}
              </p>
            </Panel>
            <Panel className="px-[18px] py-1">
              <Rows
                items={[
                  ["Attestation", `#${reserve.nonce}, signed by the vault`],
                  ["Last checked", when(reserve.asOf)],
                  [
                    "Ledger record",
                    reserve.explorerUrl ? (
                      <a key="l" href={reserve.explorerUrl} className="font-bold underline">
                        View on the explorer ↗
                      </a>
                    ) : (
                      <span key="l" className="font-mono text-[13px]">
                        {shortHash(reserve.allocationsRoot)}
                      </span>
                    ),
                  ],
                ]}
              />
            </Panel>
          </>
        ) : (
          <p className="text-ink-soft">
            The vault publishes its first attestation after the first purchase.
          </p>
        )}

        <details className="ring-line rounded-[20px] bg-surface px-[18px] py-3.5">
          <summary className="cursor-pointer font-bold">How this check works</summary>
          <div className="mt-2.5 space-y-2 text-sm leading-normal text-ink-soft">
            <p>
              After every trade the vault signs its total and a fingerprint of every customer&apos;s
              gold. That statement is published to a public ledger, where nobody (not the bank, not
              the vault) can change it afterwards.
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
      </div>
    </>
  );
}
