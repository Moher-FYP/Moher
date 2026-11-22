import { connection } from "next/server";
import { quoteBuy } from "@/app/actions";
import { AmountPad } from "@/components/AmountPad";
import { Actions, BackHeader, FormError, RoundIcon, primaryButton } from "@/components/kit";
import { getMohar } from "@/lib/mohar";
import { partner } from "@/lib/partner";
import { requireCustomer } from "@/lib/session";

export default async function Buy({ searchParams }: PageProps<"/buy">) {
  await connection();
  await requireCustomer();
  const { error } = await searchParams;
  const p = partner();
  const price = await getMohar().getPrice();

  return (
    <>
      <BackHeader title="Buy gold" backHref="/" />
      <form action={quoteBuy} className="flex flex-1 flex-col">
        <div className="px-5">
          <FormError message={typeof error === "string" ? error : undefined} />
        </div>
        <AmountPad
          modes={["pkr"]}
          labels={{ pkr: "Amount to spend" }}
          pricePerGramPkr={Number(price.pricePerGramPkr)}
          presets={p.presets}
        >
          <div className="ring-line flex items-center gap-3 rounded-[18px] bg-surface px-3.5 py-3">
            <RoundIcon name="card" tone="bg-hero text-ink" size={38} />
            <span className="flex-1">
              <span className="block text-xs text-ink-soft">Pay from</span>
              <span className="block text-[15px] font-bold">{p.ownFunds}</span>
              <span className="block text-[12.5px] text-ink-soft">
                Or another bank by Raast: choose on the next screen
              </span>
            </span>
          </div>
        </AmountPad>
        <Actions note="You see the exact grams and fees before anything is charged.">
          <button type="submit" className={primaryButton}>
            Review price
          </button>
        </Actions>
      </form>
    </>
  );
}
