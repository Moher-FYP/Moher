import type { Balance, Transaction } from "@mohar/sdk";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  Actions,
  BackHeader,
  GoldCard,
  Icon,
  Panel,
  RoundIcon,
  Seal,
  Stepper,
  primaryButton,
  quietButton,
  type Step,
} from "@/components/kit";
import { TxWatcher } from "@/components/TxStatus";
import { grams, gramsFigure, pkr, pkrWhole, shortHash, when } from "@/lib/format";
import { getMohar } from "@/lib/mohar";
import { canView, customerForWallet, requireCustomer, walletIdFor } from "@/lib/session";

const SETTLING_TITLE = {
  mint: "Buying gold",
  burn: "Selling gold",
  transfer: "Sending gold",
} as const;

const STEPS: Record<Transaction["type"], Step[]> = {
  mint: [
    { label: "Request received", sub: "Price and grams fixed" },
    { label: "Vault allocating your gold", sub: "Specific grams signed to you" },
    { label: "Recording on the ledger", sub: "One transaction, in seconds" },
    { label: "Done", sub: "Gold in your name" },
  ],
  burn: [
    { label: "Request received", sub: "Price and grams fixed" },
    { label: "Vault releasing your gold", sub: "Your grams leave your name" },
    { label: "Recording on the ledger", sub: "One transaction, in seconds" },
    { label: "Done", sub: "Money on its way to you" },
  ],
  transfer: [
    { label: "Request received", sub: "Grams fixed" },
    { label: "Checking both accounts", sub: "Limits and holds" },
    { label: "Recording on the ledger", sub: "One transaction, in seconds" },
    { label: "Done", sub: "Gold in their name" },
  ],
};

/** Plain words for MOHAR's failure codes (docs/openapi.yaml, Error.code). */
const FAILURES: Record<string, { title: string; text: string; step: string }> = {
  price_moved: {
    title: "The gold price moved",
    text: "It moved more than 0.5% before your trade settled, so it was cancelled to protect you.",
    step: "Price check failed: market moved more than 0.5%",
  },
  minting_paused: {
    title: "Buying is paused",
    text: "New purchases pause automatically while the vault is reconciled. Selling stays open.",
    step: "Paused by the reserve check",
  },
  wallet_frozen: {
    title: "Your gold savings are on hold",
    text: "Contact the bank to find out why.",
    step: "Account on hold",
  },
  insufficient_balance: {
    title: "Not enough gold",
    text: "You don't have enough gold for this.",
    step: "Balance check failed",
  },
};

export default async function TransactionPage({ params }: PageProps<"/tx/[id]">) {
  await connection();
  const customer = await requireCustomer();
  const { id } = await params;
  const txn = await getMohar()
    .getTransaction(id)
    .catch(() => notFound());
  if (!(await canView(customer, txn))) notFound();
  const own = await walletIdFor(customer);

  if (txn.status === "failed") return <Cancelled txn={txn} />;
  if (txn.status === "confirmed") {
    const balance = await getMohar().getBalance(own);
    return (
      <Done
        txn={txn}
        balance={balance}
        incoming={txn.type === "transfer" && txn.walletId !== own}
      />
    );
  }
  return <Settling txn={txn} />;
}

function Settling({ txn }: { txn: Transaction }) {
  const reached = txn.status === "pending" ? 1 : 2;
  return (
    <>
      <TxWatcher id={txn.id} status={txn.status} />
      <BackHeader title={SETTLING_TITLE[txn.type]} backHref="/" />
      <div className="flex flex-col gap-4 px-5 pt-2">
        <section className="pt-[18px] pb-1.5 text-center">
          <div className="mx-auto grid size-24 place-items-center rounded-full bg-sand">
            <span className="pulse-seal">
              <Seal height={40} />
            </span>
          </div>
          <h2 className="mt-[18px] font-display text-[26px] font-extrabold tracking-[-0.03em]">
            {txn.type === "mint"
              ? "Settling your gold"
              : txn.type === "burn"
                ? "Settling your sale"
                : "Sending your gold"}
          </h2>
          <p className="mt-1.5 text-ink-soft">
            {grams(txn.grams)}
            {txn.netAmountPkr ? ` for ${pkrWhole(txn.netAmountPkr)}` : ""} · usually under 10
            seconds
          </p>
        </section>
        <Panel className="px-5 pt-5 pb-1.5">
          <Stepper steps={STEPS[txn.type]} reached={reached} />
        </Panel>
      </div>
      <Actions note="You can leave this screen. The trade carries on without it.">
        <Link href="/" className={quietButton}>
          Back to home
        </Link>
      </Actions>
    </>
  );
}

function Done({
  txn,
  balance,
  incoming,
}: {
  txn: Transaction;
  balance: Balance;
  incoming: boolean;
}) {
  const other = customerForWallet(incoming ? txn.walletId : txn.counterpartyWalletId);
  const g = gramsFigure(txn.grams);
  const copy =
    txn.type === "mint"
      ? {
          header: "Purchase complete",
          title: `${g} g is yours`,
          sub: `${pkr(txn.netAmountPkr ?? "0")} paid · allocated in your name`,
          delta: `+${g} g`,
        }
      : txn.type === "burn"
        ? {
            header: "Sale complete",
            title: `${g} g sold`,
            sub: `${pkr(txn.netAmountPkr ?? "0")} on its way to you`,
            delta: `−${g} g`,
          }
        : incoming
          ? {
              header: "Gold received",
              title: `${g} g received`,
              sub: `From ${other?.name ?? "another customer"}`,
              delta: `+${g} g`,
            }
          : {
              header: "Gold sent",
              title: `${g} g sent`,
              sub: `To ${other?.name ?? "another customer"} · no fee`,
              delta: `−${g} g`,
            };
  return (
    <>
      <BackHeader title={copy.header} backHref="/" />
      <div className="flex flex-col gap-3.5 px-5 pt-2.5">
        <section className="text-center">
          <div className="mx-auto grid size-20 place-items-center rounded-full bg-ok text-white">
            <Icon name="check" size={40} stroke={3} />
          </div>
          <h2 className="mt-4 font-display text-[30px] font-extrabold tracking-[-0.03em]">
            {copy.title}
          </h2>
          <p className="mt-1.5 text-ink-soft">{copy.sub}</p>
        </section>
        <GoldCard
          label="New balance"
          big={38}
          grams={gramsFigure(balance.grams)}
          title={`${balance.grams} g`}
          pkr={`≈ ${pkrWhole(balance.valuePkr)}`}
          sub={`${pkrWhole(balance.price.pricePerGramPkr)} per gram`}
          delta={copy.delta}
        />
        <Panel className="px-4 py-3.5">
          <div className="flex items-center gap-3">
            <RoundIcon name="shield" tone="bg-sage text-ok" size={36} />
            <p className="text-sm leading-[1.45] text-ink-soft">
              {txn.type === "mint"
                ? "The vault confirmed your grams. Settled spot, in one ledger transaction"
                : "Settled spot, in one ledger transaction"}
              {txn.txHash ? (
                <>
                  :{" "}
                  {txn.explorerUrl ? (
                    <a href={txn.explorerUrl} className="font-mono text-[13px] text-ink underline">
                      {shortHash(txn.txHash)}
                    </a>
                  ) : (
                    <span className="font-mono text-[13px]">{shortHash(txn.txHash)}</span>
                  )}
                </>
              ) : (
                "."
              )}
            </p>
          </div>
        </Panel>
      </div>
      <Actions>
        <Link href={`/tx/${txn.id}/receipt`} className={primaryButton}>
          <Icon name="print" size={20} />
          View receipt
        </Link>
        <Link href="/" className={quietButton}>
          Done
        </Link>
      </Actions>
    </>
  );
}

function Cancelled({ txn }: { txn: Transaction }) {
  const failure = FAILURES[txn.failureCode ?? ""] ?? {
    title: "Not completed",
    text: "The trade could not be completed. Try again.",
    step: "Could not complete",
  };
  const again = txn.type === "mint" ? "/buy" : txn.type === "burn" ? "/sell" : "/send";
  const kept =
    txn.type === "mint"
      ? `${txn.netAmountPkr ? pkr(txn.netAmountPkr) : "Your money"} stays in your account. No gold moved.`
      : "Your gold stays in your name. Nothing moved.";
  return (
    <>
      <BackHeader title="Trade cancelled" backHref="/" />
      <div className="flex flex-col gap-3.5 px-5 pt-2.5">
        <section className="text-center">
          <div className="mx-auto grid size-20 place-items-center rounded-full bg-apricot text-[#7a3208]">
            <Icon name="refresh" size={38} stroke={2.4} />
          </div>
          <h2 className="mt-4 font-display text-[28px] font-extrabold tracking-[-0.03em]">
            {failure.title}
          </h2>
          <p className="mx-auto mt-2 max-w-[30ch] leading-normal text-ink-soft">{failure.text}</p>
        </section>
        <Panel className="p-4">
          <div className="flex items-center gap-3">
            <RoundIcon name="check" tone="bg-ok-pale text-ok" size={40} />
            <div>
              <p className="font-bold">Nothing was charged</p>
              <p className="mt-0.5 text-sm text-ink-soft">{kept}</p>
            </div>
          </div>
        </Panel>
        <Panel className="px-5 pt-5 pb-1.5">
          <Stepper
            steps={[
              { label: "Request received", sub: when(txn.createdAt) },
              { label: failure.step, sub: txn.failureCode ? `Code ${txn.failureCode}` : "" },
            ]}
            reached={1}
            failed={1}
          />
        </Panel>
      </div>
      <Actions>
        <Link href={again} className={primaryButton}>
          <Icon name="refresh" size={20} />
          {txn.type === "transfer" ? "Try again" : "Get a new price"}
        </Link>
        <Link href="/" className={quietButton}>
          Back to home
        </Link>
      </Actions>
    </>
  );
}
