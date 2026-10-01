import { connection } from "next/server";
import { quoteSell } from "@/app/actions";
import { AppHeader } from "@/components/AppHeader";
import { FormError, fieldClass, primaryButton } from "@/components/ui";
import { grams, pkr } from "@/lib/format";
import { getMohar } from "@/lib/mohar";
import { requireCustomer, withWallet } from "@/lib/session";

export default async function Sell({ searchParams }: PageProps<"/sell">) {
  await connection();
  const customer = await requireCustomer();
  const { error } = await searchParams;
  const balance = await withWallet(customer, (walletId) => getMohar().getBalance(walletId));
  const hasGold = Number(balance.grams) > 0;

  return (
    <>
      <AppHeader customer={customer} title="Sell gold" backHref="/" />
      <form action={quoteSell} className="space-y-5 p-5">
        <FormError message={typeof error === "string" ? error : undefined} />
        <div className="rounded-2xl bg-paper px-4 py-3">
          <p className="text-sm text-ink-soft">You have</p>
          <p className="font-display text-2xl font-semibold" title={`${balance.grams} g`}>
            {grams(balance.grams)}
          </p>
          <p className="text-sm text-ink-soft">worth about {pkr(balance.valuePkr)}</p>
        </div>

        {hasGold ? (
          <>
            <div className="space-y-2">
              <label htmlFor="grams" className="block font-semibold">
                How many grams do you want to sell?
              </label>
              <div className="relative">
                <input
                  id="grams"
                  name="grams"
                  inputMode="decimal"
                  autoComplete="off"
                  required
                  placeholder="0.25"
                  className={`${fieldClass} pr-10`}
                />
                <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-lg font-semibold text-ink-soft">
                  g
                </span>
              </div>
            </div>
            <button type="submit" className={primaryButton}>
              See price
            </button>
            <button
              type="submit"
              formNoValidate
              name="grams"
              value={balance.grams}
              className="text-sm font-semibold text-bank underline-offset-2 hover:underline"
            >
              Sell all {grams(balance.grams)}
            </button>
            <p className="text-sm text-ink-soft">
              The money reaches your account once the sale settles.
            </p>
          </>
        ) : (
          <p className="text-ink-soft">You don&apos;t have any gold to sell yet.</p>
        )}
      </form>
    </>
  );
}
