import { connection } from "next/server";
import { quoteSell } from "@/app/actions";
import { AmountPad } from "@/components/AmountPad";
import { Actions, BackHeader, FormError, primaryButton } from "@/components/kit";
import { grams, pkrWhole } from "@/lib/format";
import { getMohar } from "@/lib/mohar";
import { partner } from "@/lib/partner";
import { requireCustomer, withWallet } from "@/lib/session";

export default async function Sell({ searchParams }: PageProps<"/sell">) {
  await connection();
  const customer = await requireCustomer();
  const { error } = await searchParams;
  const balance = await withWallet(customer, (walletId) => getMohar().getBalance(walletId));
  const hasGold = Number(balance.grams) > 0;
  const to = partner().kind === "bank" ? "to your current account" : "to your wallet balance";

  return (
    <>
      <BackHeader title="Sell gold" backHref="/" />
      <form action={quoteSell} className="flex flex-1 flex-col">
        <div className="px-5">
          <FormError message={typeof error === "string" ? error : undefined} />
        </div>
        {hasGold ? (
          <>
            <AmountPad
              modes={["grams", "pkr"]}
              labels={{ grams: "Gold to sell", pkr: "Money to receive" }}
              pricePerGramPkr={Number(balance.price.pricePerGramPkr)}
              destination={to}
            >
              <div className="flex items-center justify-between gap-3 rounded-[18px] bg-sand py-3 pr-3.5 pl-4">
                <span>
                  <span className="block text-[12.5px] text-ink-soft">Available to sell</span>
                  <span
                    className="font-display text-[17px] font-extrabold"
                    title={`${balance.grams} g`}
                  >
                    {grams(balance.grams)}
                  </span>
                  <span className="text-[13px] text-ink-soft"> · {pkrWhole(balance.valuePkr)}</span>
                </span>
                {/* Its own form field, so "Sell all" sells the exact balance, all 8 decimals. */}
                <button
                  type="submit"
                  name="sellAll"
                  value={balance.grams}
                  formNoValidate
                  className="h-9 rounded-full bg-surface px-3.5 text-[13px] font-bold text-ink hover:bg-page"
                >
                  Sell all
                </button>
              </div>
            </AmountPad>
            <Actions note="The money reaches you once the sale settles, in seconds.">
              <button type="submit" className={primaryButton}>
                Review price
              </button>
            </Actions>
          </>
        ) : (
          <p className="px-5 pt-4 text-ink-soft">You don&apos;t have any gold to sell yet.</p>
        )}
      </form>
    </>
  );
}
