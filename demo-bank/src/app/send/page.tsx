import { connection } from "next/server";
import { sendGold } from "@/app/actions";
import { Actions, BackHeader, FormError, Icon, fieldClass, primaryButton } from "@/components/kit";
import { allCustomers } from "@/lib/customers";
import { grams, initials, pkrWhole } from "@/lib/format";
import { getMohar } from "@/lib/mohar";
import { partner } from "@/lib/partner";
import { requireCustomer, withWallet } from "@/lib/session";

const AVATAR_TONES = ["bg-apricot", "bg-sage", "bg-sky", "bg-sand"];

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
      <BackHeader title="Send gold" backHref="/" />
      <form action={sendGold} className="flex flex-1 flex-col">
        <div className="flex flex-col gap-3.5 px-5 pt-2">
          <FormError message={typeof error === "string" ? error : undefined} />
          <fieldset>
            <legend className="mb-2.5 text-sm font-bold">Send to</legend>
            {recipients.length ? (
              <div className="grid grid-cols-3 gap-2">
                {recipients.map((r, i) => (
                  <label
                    key={r.id}
                    className="ring-line flex cursor-pointer flex-col items-center gap-1.5 rounded-[20px] bg-surface px-1 py-3 text-center text-[13px] font-bold has-[:checked]:shadow-[inset_0_0_0_2px_var(--color-primary)] has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-seal"
                  >
                    <input
                      type="radio"
                      name="recipient"
                      value={r.id}
                      defaultChecked={i === 0}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={`grid size-11 place-items-center rounded-full font-display font-extrabold ${AVATAR_TONES[i % AVATAR_TONES.length]}`}
                    >
                      {initials(r.name)}
                    </span>
                    <span className="w-full truncate px-1">{r.firstName}</span>
                    <span className="text-[11.5px] font-medium text-ink-soft">
                      {r.onboarding?.phoneMasked ?? `${partner().word} customer`}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-soft">
                No other {partner().name} customers yet. Open a second account to try sending.
              </p>
            )}
          </fieldset>

          <div>
            <label htmlFor="grams" className="mb-1.5 block text-sm font-bold">
              Amount of gold
            </label>
            <div className="relative">
              <input
                id="grams"
                name="grams"
                inputMode="decimal"
                autoComplete="off"
                required
                placeholder="0.5000"
                className={`${fieldClass} pr-10`}
              />
              <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 font-bold text-ink-soft">
                g
              </span>
            </div>
            <p className="mt-1.5 text-[13px] text-ink-soft">
              You have {grams(balance.grams)} (≈ {pkrWhole(balance.valuePkr)}).
            </p>
          </div>
        </div>
        <Actions note="Sending gold is free. The same grams move from your name to theirs.">
          <button type="submit" disabled={!recipients.length} className={primaryButton}>
            <Icon name="send" size={20} />
            Send gold
          </button>
        </Actions>
      </form>
    </>
  );
}
