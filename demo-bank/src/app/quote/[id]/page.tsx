import { redirect } from "next/navigation";
import { confirmQuote } from "@/app/actions";
import { ConfirmQuote } from "@/components/ConfirmQuote";
import { BackHeader, FormError, Panel, Rows } from "@/components/kit";
import { QuoteChip } from "@/components/QuoteCountdown";
import { gramsFigure, pkr } from "@/lib/format";
import { partner } from "@/lib/partner";
import { recallQuote } from "@/lib/quotes";
import { requireCustomer } from "@/lib/session";

const option =
  "ring-line-strong flex cursor-pointer items-center gap-3 rounded-[18px] bg-surface px-4 py-3.5 has-[:checked]:shadow-[inset_0_0_0_2px_var(--color-ink)]";

export default async function QuotePage({ params, searchParams }: PageProps<"/quote/[id]">) {
  const customer = await requireCustomer();
  const { id } = await params;
  const { error } = await searchParams;
  const quote = recallQuote(id, customer.id);
  if (!quote) redirect("/");
  const p = partner();
  const buying = quote.side === "buy";

  return (
    <>
      <BackHeader
        title={buying ? "Review purchase" : "Review sale"}
        backHref={buying ? "/buy" : "/sell"}
      />
      <ConfirmQuote
        quoteId={quote.id}
        expiresAt={quote.expiresAt}
        againHref={buying ? "/buy" : "/sell"}
        label={buying ? `Pay ${pkr(quote.netAmountPkr)}` : `Sell for ${pkr(quote.netAmountPkr)}`}
        action={confirmQuote}
      >
        <div className="flex flex-col gap-4 px-5 pt-2 pb-2">
          <FormError message={typeof error === "string" ? error : undefined} />
          <section className="pt-1.5 pb-0.5 text-center">
            <p className="font-semibold text-ink-soft">{buying ? "You get" : "You sell"}</p>
            <p
              className="mt-1 font-display text-[58px] leading-none font-extrabold tracking-[-0.045em]"
              title={`${quote.grams} g`}
            >
              {gramsFigure(quote.grams)}
              <span className="ml-1 text-[26px]">g</span>
            </p>
            <p className="mt-1.5 mb-3.5 text-sm text-ink-soft">
              {buying
                ? "24K gold, allocated in your name"
                : "24K gold, from your name in the vault"}
            </p>
            <QuoteChip expiresAt={quote.expiresAt} />
          </section>

          <Panel className="px-[18px] pt-1.5 pb-3.5">
            <Rows
              items={[
                ["Gold price", `${pkr(quote.price.pricePerGramPkr)} per gram`],
                [buying ? "Gold value" : "Sale value", pkr(quote.grossAmountPkr)],
                ["Exchange margin", `${buying ? "+" : "−"} ${pkr(quote.fees.fxMarginPkr)}`],
              ]}
              total={[buying ? "You pay" : "You receive", pkr(quote.netAmountPkr)]}
            />
          </Panel>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-bold">
              {buying ? "Pay with" : "Send the money to"}
            </legend>
            <label className={option}>
              <input
                type="radio"
                name="payWith"
                value="own"
                defaultChecked
                className="size-5 accent-ink"
              />
              <span className="font-bold">{p.ownFunds}</span>
            </label>
            <label className={`${option} flex-wrap`}>
              <input type="radio" name="payWith" value="raast" className="peer size-5 accent-ink" />
              <span className="flex-1">
                <span className="block font-bold">Another bank, by Raast</span>
                <span className="text-[13px] text-ink-soft">
                  The State Bank&apos;s instant payments. Simulated.
                </span>
              </span>
              <input
                name="raastId"
                aria-label="Raast ID"
                placeholder="Raast ID: 0300 1234567 or PK… IBAN"
                autoComplete="off"
                className="ring-line-strong hidden h-11 w-full rounded-xl border-0 bg-page px-3 text-sm peer-checked:block focus:outline-none"
              />
            </label>
          </fieldset>
        </div>
      </ConfirmQuote>
    </>
  );
}
