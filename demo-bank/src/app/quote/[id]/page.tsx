import Link from "next/link";
import { redirect } from "next/navigation";
import { confirmQuote } from "@/app/actions";
import { AppHeader } from "@/components/AppHeader";
import { ConfirmQuote } from "@/components/ConfirmQuote";
import { FormError, quietButton } from "@/components/ui";
import { grams, pkr } from "@/lib/format";
import { partner } from "@/lib/partner";
import { recallQuote } from "@/lib/quotes";
import { requireCustomer } from "@/lib/session";

export default async function QuotePage({ params, searchParams }: PageProps<"/quote/[id]">) {
  const customer = await requireCustomer();
  const { id } = await params;
  const { error } = await searchParams;
  const quote = recallQuote(id, customer.id);
  if (!quote) redirect("/");

  const buying = quote.side === "buy";
  const rows: [string, string][] = [
    ["Gold price", `${pkr(quote.price.pricePerGramPkr)} per gram`],
    [buying ? "Gold value" : "Sale value", pkr(quote.grossAmountPkr)],
    ["Exchange margin", pkr(quote.fees.fxMarginPkr)],
  ];

  return (
    <>
      <AppHeader
        customer={customer}
        title={buying ? "Confirm purchase" : "Confirm sale"}
        backHref={buying ? "/buy" : "/sell"}
      />
      <section className="space-y-5 p-5">
        <FormError message={typeof error === "string" ? error : undefined} />

        <div className="text-center">
          <p className="text-ink-soft">{buying ? "You get" : "You sell"}</p>
          <p className="font-display text-5xl font-bold tracking-tight" title={`${quote.grams} g`}>
            {grams(quote.grams)}
          </p>
          <p className="mt-1 text-ink-soft">of fully allocated 24K gold</p>
        </div>

        <dl className="divide-y divide-line rounded-2xl border border-line">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 px-4 py-3 text-sm">
              <dt className="text-ink-soft">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="font-semibold">{buying ? "You pay" : "You receive"}</dt>
            <dd className="font-display text-lg font-semibold">{pkr(quote.netAmountPkr)}</dd>
          </div>
        </dl>

        <p className="text-sm text-ink-soft">
          No interest, no hidden charges. The gold is held in your name in the vault. If the market
          moves more than 0.5% before this settles, the trade is cancelled and nothing is charged.
        </p>

        <ConfirmQuote
          quoteId={quote.id}
          expiresAt={quote.expiresAt}
          label={buying ? `Pay ${pkr(quote.netAmountPkr)}` : `Sell ${grams(quote.grams)}`}
          action={confirmQuote}
        >
          <fieldset className="space-y-2 pb-2">
            <legend className="mb-2 font-semibold">
              {buying ? "Pay with" : "Send the money to"}
            </legend>
            <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-line p-4 has-[:checked]:border-bank has-[:checked]:bg-bank/5">
              <input
                type="radio"
                name="payWith"
                value="own"
                defaultChecked
                className="accent-bank"
              />
              <span className="font-medium">{partner().ownFunds}</span>
            </label>
            <label className="block cursor-pointer space-y-3 rounded-2xl border border-line p-4 has-[:checked]:border-bank has-[:checked]:bg-bank/5">
              <span className="flex items-center gap-3">
                <input type="radio" name="payWith" value="raast" className="accent-bank" />
                <span>
                  <span className="block font-medium">Another bank, by Raast</span>
                  <span className="text-sm text-ink-soft">
                    The State Bank&apos;s instant payments. Simulated in this demo.
                  </span>
                </span>
              </span>
              <input
                name="raastId"
                aria-label="Raast ID"
                placeholder="Raast ID: 0300 1234567 or PK… IBAN"
                autoComplete="off"
                className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm"
              />
            </label>
          </fieldset>
        </ConfirmQuote>
        <Link href="/" className={quietButton}>
          Cancel
        </Link>
      </section>
    </>
  );
}
