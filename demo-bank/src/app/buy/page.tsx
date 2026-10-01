import { quoteBuy } from "@/app/actions";
import { AppHeader } from "@/components/AppHeader";
import { FormError, fieldClass, primaryButton } from "@/components/ui";
import { requireCustomer } from "@/lib/session";

const PRESETS = ["1000", "5000", "25000"];

export default async function Buy({ searchParams }: PageProps<"/buy">) {
  const customer = await requireCustomer();
  const { error } = await searchParams;

  return (
    <>
      <AppHeader customer={customer} title="Buy gold" backHref="/" />
      <form action={quoteBuy} className="space-y-5 p-5">
        <FormError message={typeof error === "string" ? error : undefined} />
        <div className="space-y-2">
          <label htmlFor="amountPkr" className="block font-semibold">
            How much do you want to spend?
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-lg font-semibold text-ink-soft">
              Rs
            </span>
            <input
              id="amountPkr"
              name="amountPkr"
              inputMode="decimal"
              autoComplete="off"
              required
              placeholder="5,000"
              className={`${fieldClass} pl-12`}
            />
          </div>
          <p className="text-sm text-ink-soft">From Rs 100. Paid from your current account.</p>
        </div>

        <button type="submit" className={primaryButton}>
          See price
        </button>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-2 text-sm text-ink-soft">Or pick an amount</legend>
          {PRESETS.map((amount) => (
            <button
              key={amount}
              type="submit"
              formNoValidate
              name="amountPkr"
              value={amount}
              className="flex-1 rounded-full border border-line px-3 py-2 text-sm font-semibold hover:border-bank"
            >
              Rs {Number(amount).toLocaleString("en-PK")}
            </button>
          ))}
        </fieldset>
        <p className="text-sm text-ink-soft">
          You&apos;ll see the exact grams and fees before anything is charged. The price is held for
          60 seconds.
        </p>
      </form>
    </>
  );
}
