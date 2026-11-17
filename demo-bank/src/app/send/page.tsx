import { connection } from "next/server";
import { sendGold } from "@/app/actions";
import { AppHeader } from "@/components/AppHeader";
import { FormError, fieldClass, primaryButton } from "@/components/ui";
import { allCustomers } from "@/lib/customers";
import { partner } from "@/lib/partner";
import { grams } from "@/lib/format";
import { getMohar } from "@/lib/mohar";
import { requireCustomer, withWallet } from "@/lib/session";

export default async function Send({ searchParams }: PageProps<"/send">) {
  await connection();
  const customer = await requireCustomer();
  const { error } = await searchParams;
  const balance = await withWallet(customer, (walletId) => getMohar().getBalance(walletId));
  // Gold moves between customers of the same partner, whose wallets MOHAR knows by name.
  const recipients = allCustomers().filter(
    (c) => c.id !== customer.id && c.onboarding?.outcome !== "referred",
  );

  return (
    <>
      <AppHeader customer={customer} title="Send gold" backHref="/" />
      <form action={sendGold} className="space-y-5 p-5">
        <FormError message={typeof error === "string" ? error : undefined} />
        <fieldset className="space-y-2">
          <legend className="mb-2 font-semibold">Who are you sending to?</legend>
          {recipients.map((r, i) => (
            <label
              key={r.id}
              className="flex cursor-pointer items-center gap-3 rounded-2xl border border-line p-4 has-[:checked]:border-bank has-[:checked]:bg-bank/5"
            >
              <input
                type="radio"
                name="recipient"
                value={r.id}
                defaultChecked={i === 0}
                className="accent-bank"
              />
              <span>
                <span className="block font-semibold">{r.name}</span>
                <span className="text-sm text-ink-soft">{partner().name} customer</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="space-y-2">
          <label htmlFor="grams" className="block font-semibold">
            How much gold?
          </label>
          <div className="relative">
            <input
              id="grams"
              name="grams"
              inputMode="decimal"
              autoComplete="off"
              required
              placeholder="0.1"
              className={`${fieldClass} pr-10`}
            />
            <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-lg font-semibold text-ink-soft">
              g
            </span>
          </div>
          <p className="text-sm text-ink-soft">You have {grams(balance.grams)}. No fee.</p>
        </div>

        <button type="submit" className={primaryButton}>
          Send gold
        </button>
      </form>
    </>
  );
}
