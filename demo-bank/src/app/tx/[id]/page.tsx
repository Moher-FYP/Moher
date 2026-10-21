import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AppHeader } from "@/components/AppHeader";
import { TxStatus } from "@/components/TxStatus";
import { primaryButton } from "@/components/ui";
import { grams, pkr, shortHash, when } from "@/lib/format";
import { getMohar } from "@/lib/mohar";
import { canView, requireCustomer } from "@/lib/session";

const TITLES = { mint: "Buying gold", burn: "Selling gold", transfer: "Sending gold" } as const;

export default async function TransactionPage({ params }: PageProps<"/tx/[id]">) {
  await connection();
  const customer = await requireCustomer();
  const { id } = await params;
  const txn = await getMohar()
    .getTransaction(id)
    .catch(() => notFound());
  if (!(await canView(customer, txn))) notFound();

  return (
    <>
      <AppHeader customer={customer} title={TITLES[txn.type]} backHref="/" />
      <section className="space-y-6 p-5">
        <div className="text-center">
          <p className="font-display text-4xl font-bold" title={`${txn.grams} g`}>
            {grams(txn.grams)}
          </p>
          {txn.netAmountPkr ? (
            <p className="mt-1 text-ink-soft">
              {txn.type === "mint" ? "for" : "for about"} {pkr(txn.netAmountPkr)}
            </p>
          ) : null}
          <p className="mt-1 text-sm text-ink-soft">{when(txn.createdAt)}</p>
        </div>

        <TxStatus initial={txn} />

        {txn.txHash ? (
          <p className="text-center text-sm text-ink-soft">
            Ledger reference{" "}
            {txn.explorerUrl ? (
              <a href={txn.explorerUrl} className="font-mono text-bank underline">
                {shortHash(txn.txHash)}
              </a>
            ) : (
              <span className="font-mono">{shortHash(txn.txHash)}</span>
            )}
          </p>
        ) : null}

        <Link href="/" className={primaryButton}>
          Back to Gold Savings
        </Link>
      </section>
    </>
  );
}
