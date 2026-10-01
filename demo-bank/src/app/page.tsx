import Link from "next/link";
import { connection } from "next/server";
import { AppHeader } from "@/components/AppHeader";
import { Seal } from "@/components/Seal";
import { grams, pkr, when } from "@/lib/format";
import { getMohar } from "@/lib/mohar";
import { requireCustomer, withWallet } from "@/lib/session";

const LABELS = { mint: "Bought gold", burn: "Sold gold", transfer: "Sent gold" } as const;

export default async function Home() {
  await connection();
  const customer = await requireCustomer();

  let data;
  try {
    data = await withWallet(customer, async (walletId) => {
      const [balance, activity] = await Promise.all([
        getMohar().getBalance(walletId),
        getMohar().listTransactions({ walletId, limit: 5 }),
      ]);
      return { walletId, balance, activity: activity.data };
    });
  } catch {
    return (
      <>
        <AppHeader customer={customer} />
        <section className="space-y-3 p-6">
          <h1 className="font-display text-2xl font-semibold">Gold Savings is unavailable</h1>
          <p className="text-ink-soft">
            The bank can&apos;t reach its gold provider right now. Start the MOHAR API (
            <code className="font-mono text-sm">pnpm --filter @mohar/api dev</code>) and refresh.
          </p>
        </section>
      </>
    );
  }

  const { balance, activity, walletId } = data;

  return (
    <>
      <AppHeader customer={customer} />

      <section className="space-y-5 p-5">
        <p className="text-ink-soft">Assalam-o-alaikum, {customer.firstName}</p>

        <div className="gold-card settle-in rounded-3xl p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold opacity-75">Gold Savings</p>
              <p
                className="mt-2 font-display text-5xl leading-none font-bold tracking-tight"
                title={`${balance.grams} g`}
              >
                {Number(balance.grams).toFixed(4)}
                <span className="ml-1 text-2xl font-semibold">g</span>
              </p>
              <p className="mt-2 text-lg font-semibold">{pkr(balance.valuePkr)}</p>
            </div>
            <Seal />
          </div>
          <p className="mt-5 text-sm opacity-80">
            {pkr(balance.price.pricePerGramPkr)} per gram, updated {when(balance.price.asOf)}
          </p>
        </div>

        <nav aria-label="Gold actions" className="grid grid-cols-3 gap-3">
          {[
            { href: "/buy", label: "Buy gold" },
            { href: "/sell", label: "Sell gold" },
            { href: "/send", label: "Send gold" },
          ].map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="rounded-2xl border border-line bg-paper px-2 py-4 text-center text-sm font-semibold hover:border-bank hover:bg-surface"
            >
              {action.label}
            </Link>
          ))}
        </nav>

        <Link
          href="/verify"
          className="flex items-center justify-between rounded-2xl bg-bank/5 px-4 py-3 text-sm hover:bg-bank/10"
        >
          <span>
            <span className="block font-semibold text-bank">Check your gold is in the vault</span>
            <span className="text-ink-soft">Every gram is allocated and publicly verifiable</span>
          </span>
          <span aria-hidden="true" className="text-xl text-bank">
            ›
          </span>
        </Link>
      </section>

      <section aria-labelledby="activity" className="border-t border-line p-5">
        <h2 id="activity" className="font-display text-lg font-semibold">
          Recent activity
        </h2>
        {activity.length === 0 ? (
          <p className="mt-3 text-ink-soft">
            No gold yet. Start with as little as Rs 100 — buy a fraction of a gram, not a whole
            tola.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {activity.map((txn) => {
              const incoming =
                txn.type === "mint" || (txn.type === "transfer" && txn.walletId !== walletId);
              return (
                <li key={txn.id}>
                  <Link href={`/tx/${txn.id}`} className="flex items-center justify-between py-3">
                    <span>
                      <span className="block font-medium">
                        {txn.type === "transfer" && incoming ? "Received gold" : LABELS[txn.type]}
                      </span>
                      <span className="text-sm text-ink-soft">
                        {when(txn.createdAt)}
                        {txn.status === "failed" ? ", not completed" : ""}
                        {txn.status === "pending" || txn.status === "submitted"
                          ? ", processing"
                          : ""}
                      </span>
                    </span>
                    <span
                      className={
                        txn.status === "failed"
                          ? "text-ink-soft line-through"
                          : incoming
                            ? "font-semibold text-bank"
                            : "font-semibold"
                      }
                    >
                      {incoming ? "+" : "−"}
                      {grams(txn.grams)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
