import { MoharApiError, type Transaction } from "@mohar/sdk";
import Link from "next/link";
import { connection } from "next/server";
import {
  ActivityRow,
  GoldCard,
  HomeHeader,
  Icon,
  Panel,
  RoundIcon,
  SectionTitle,
  TabBar,
  type IconName,
} from "@/components/kit";
import { errorMessage, grams, gramsFigure, initials, pkrWhole, tola, when } from "@/lib/format";
import { getMohar } from "@/lib/mohar";
import { partner } from "@/lib/partner";
import { customerForWallet, requireCustomer, withWallet } from "@/lib/session";

export default async function Home() {
  await connection();
  const customer = await requireCustomer();
  const p = partner();
  const header = (
    <HomeHeader word={p.word} initials={initials(customer.name)} name={customer.name} />
  );

  let data;
  try {
    data = await withWallet(customer, async (walletId) => {
      const [balance, activity] = await Promise.all([
        getMohar().getBalance(walletId),
        getMohar().listTransactions({ walletId, limit: 5 }),
      ]);
      return { walletId, balance, activity: activity.data };
    });
  } catch (error) {
    // MOHAR answered with an error (a refused key, a conflict…), or did not answer at all.
    const answered = error instanceof MoharApiError;
    return (
      <>
        {header}
        <section className="flex flex-col gap-3 px-5 pt-6">
          <RoundIcon name="pause" tone="bg-apricot text-ink" size={48} />
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.03em]">
            Gold Savings is unavailable
          </h1>
          {answered ? (
            <p className="text-ink-soft">
              The gold provider refused the request: {errorMessage(error)} (
              <code className="font-mono text-sm">{error.code}</code>). The details are under Behind
              the scenes.
            </p>
          ) : (
            <p className="text-ink-soft">
              The {p.kind} can&apos;t reach its gold provider right now. Start the MOHAR API (
              <code className="font-mono text-sm">pnpm --filter @mohar/api dev</code>) and refresh.
            </p>
          )}
        </section>
        <TabBar word={p.word} />
      </>
    );
  }

  const { balance, activity, walletId } = data;
  const actions: [string, IconName, string, string][] = [
    ["Buy", "buy", "/buy", "bg-seal text-[#1a0f05]"],
    ["Sell", "sell", "/sell", "bg-sand text-ink"],
    ["Send", "send", "/send", "bg-sky text-ink"],
  ];

  return (
    <>
      {header}
      <div className="flex flex-col gap-3.5 px-5 pt-2 pb-6">
        <p className="text-[15px] text-ink-soft">Assalam-o-alaikum, {customer.firstName}</p>

        <GoldCard
          grams={gramsFigure(balance.grams)}
          title={`${balance.grams} g`}
          pkr={`≈ ${pkrWhole(balance.valuePkr)}`}
          sub={`≈ ${tola(balance.grams)} tola · ${pkrWhole(balance.price.pricePerGramPkr)} per gram`}
        />

        <nav aria-label="Gold actions" className="grid grid-cols-3 gap-2.5">
          {actions.map(([label, icon, href, tone]) => (
            <Link
              key={href}
              href={href}
              className="ring-line flex flex-col items-center gap-2 rounded-[22px] bg-surface px-1.5 pt-3.5 pb-3 text-sm font-bold text-ink hover:bg-page"
            >
              <RoundIcon name={icon} tone={tone} size={42} />
              {label}
            </Link>
          ))}
        </nav>

        <Link
          href="/verify"
          className="flex items-center gap-3 rounded-[22px] bg-sage px-4 py-3.5 text-ink hover:brightness-[0.98]"
        >
          <RoundIcon name="shield" tone="bg-white/75 text-ok" size={40} />
          <span className="flex-1">
            <span className="block font-bold">Your gold is in the vault</span>
            <span className="text-[13px] text-[#3f4a3c]">
              In your name, checked after each trade
            </span>
          </span>
          <Icon name="chev" size={18} />
        </Link>

        <Panel className="px-[18px] pt-4 pb-1.5">
          <SectionTitle>Recent activity</SectionTitle>
          {activity.length === 0 ? (
            <p className="py-3 text-sm text-ink-soft">
              No gold yet. Start with as little as Rs {p.fromPkr.toLocaleString("en-PK")}: buy a
              fraction of a gram, not a whole tola.
            </p>
          ) : (
            <div className="mt-1">
              {activity.map((txn, i) => (
                <Activity key={txn.id} txn={txn} walletId={walletId} first={i === 0} />
              ))}
            </div>
          )}
        </Panel>
      </div>
      <TabBar word={p.word} />
    </>
  );
}

function Activity({
  txn,
  walletId,
  first,
}: {
  txn: Transaction;
  walletId: string;
  first: boolean;
}) {
  const incoming = txn.type === "mint" || (txn.type === "transfer" && txn.walletId !== walletId);
  const failed = txn.status === "failed";
  const pending = txn.status === "pending" || txn.status === "submitted";
  let name = txn.type === "mint" ? "Bought gold" : txn.type === "burn" ? "Sold gold" : "";
  let icon: IconName = txn.type === "mint" ? "buy" : txn.type === "burn" ? "sell" : "send";
  let tone = txn.type === "mint" ? "bg-sand" : txn.type === "burn" ? "bg-stone" : "bg-sky";
  if (txn.type === "transfer") {
    const other = customerForWallet(incoming ? txn.walletId : txn.counterpartyWalletId);
    name = incoming
      ? `Received from ${other?.firstName ?? "a customer"}`
      : `Sent gold to ${other?.firstName ?? "a customer"}`;
    if (incoming) {
      icon = "receive";
      tone = "bg-apricot";
    }
  }
  if (failed) {
    icon = "refresh";
    tone = "bg-apricot";
  }
  return (
    <ActivityRow
      first={first}
      href={`/tx/${txn.id}`}
      icon={icon}
      iconTone={tone}
      name={name}
      sub={`${when(txn.createdAt)}${failed ? ", cancelled" : pending ? ", settling" : ""}`}
      amount={`${incoming ? "+" : "−"}${grams(txn.grams)}`}
      tone={incoming && !failed ? "text-ok" : "text-ink"}
      strike={failed}
    />
  );
}
