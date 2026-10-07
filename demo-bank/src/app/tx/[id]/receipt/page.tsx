import type { Quote, Transaction } from "@mohar/sdk";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppHeader";
import { PrintButton } from "@/components/PrintButton";
import { quietButton } from "@/components/ui";
import type { Customer } from "@/lib/customers";
import { exactGrams, fullDate, grams, pkr, shortHash, usd } from "@/lib/format";
import { getMohar } from "@/lib/mohar";
import { recallQuote } from "@/lib/quotes";
import { canView, customerForWallet, requireCustomer, walletIdFor } from "@/lib/session";

/**
 * The customer's receipt for a settled trade. Everything on it comes from two places: the
 * transaction MOHAR returns (grams, ledger reference, times) and the quote the bank showed the
 * customer before they confirmed (price and charges). Only settled trades get a receipt.
 */
export default async function ReceiptPage({ params }: PageProps<"/tx/[id]/receipt">) {
  await connection();
  const customer = await requireCustomer();
  const { id } = await params;
  const txn = await getMohar()
    .getTransaction(id)
    .catch(() => notFound());
  if (!(await canView(customer, txn))) notFound();
  if (txn.status !== "confirmed") redirect(`/tx/${txn.id}`);

  const quote = txn.quoteId ? recallQuote(txn.quoteId, customer.id) : undefined;
  const incoming = txn.type === "transfer" && txn.walletId !== (await walletIdFor(customer));
  const kind = txn.type === "mint" ? "buy" : txn.type === "burn" ? "sell" : incoming ? "in" : "out";
  const settledAt = txn.confirmedAt ?? txn.createdAt;

  return (
    <>
      <AppHeader customer={customer} title="Receipt" backHref={`/tx/${txn.id}`} />
      <article className="space-y-6 p-5" aria-labelledby="receipt-title">
        <header className="space-y-1 border-b border-dashed border-line pb-5 text-center">
          <p className="text-sm font-semibold tracking-wide text-bank uppercase">
            Demo Bank · Gold Savings
          </p>
          <h1 id="receipt-title" className="font-display text-xl font-semibold">
            {HEADINGS[kind]}
          </h1>
          <Headline kind={kind} txn={txn} />
          <p className="text-sm text-ink-soft">{fullDate(settledAt)}</p>
        </header>

        <Section title="Details">
          <Row label="Receipt number" value={<span className="font-mono">{txn.id}</span>} />
          <Row label="Customer" value={customer.name} />
          <Row label="Account" value="Gold Savings" />
          <Counterparty kind={kind} txn={txn} />
        </Section>

        <Section title="Gold">
          <Row label="Quantity" value={exactGrams(txn.grams)} />
          <Row label="Purity" value="24 karat" />
          <Row label="Held" value={HELD[kind]} />
        </Section>

        {kind === "buy" || kind === "sell" ? <Charges kind={kind} txn={txn} quote={quote} /> : null}

        <Section title="Settlement">
          <Row label="Status" value="Settled" />
          <Row label="Type" value="Spot, in one ledger transaction" />
          {txn.txHash ? (
            <Row
              label="Ledger reference"
              value={
                txn.explorerUrl ? (
                  <a href={txn.explorerUrl} className="font-mono text-bank underline">
                    {shortHash(txn.txHash)}
                  </a>
                ) : (
                  <span className="font-mono">{shortHash(txn.txHash)}</span>
                )
              }
            />
          ) : null}
          {txn.blockNumber !== undefined ? (
            <Row label="Block" value={txn.blockNumber.toLocaleString("en-PK")} />
          ) : null}
        </Section>

        <p className="rounded-2xl bg-paper p-4 text-sm text-ink-soft">
          No interest is charged or paid. Every gram in Gold Savings is matched by gold held in the
          vault; you can check it any time on{" "}
          <Link href="/verify" className="font-semibold text-bank underline">
            Your gold in the vault
          </Link>
          .
        </p>

        <div className="space-y-3 print:hidden">
          <PrintButton />
          <Link href="/" className={quietButton}>
            Back to Gold Savings
          </Link>
        </div>
      </article>
    </>
  );
}

type Kind = "buy" | "sell" | "in" | "out";

const HEADINGS: Record<Kind, string> = {
  buy: "Gold purchase",
  sell: "Gold sale",
  in: "Gold received",
  out: "Gold sent",
};

const HELD: Record<Kind, string> = {
  buy: "In your name in the vault",
  sell: "Released from the vault",
  in: "In your name in the vault",
  out: "Moved to the recipient's name",
};

function Headline({ kind, txn }: { kind: Kind; txn: Transaction }) {
  if ((kind === "buy" || kind === "sell") && txn.netAmountPkr) {
    return (
      <>
        <p className="font-display text-4xl font-bold">{pkr(txn.netAmountPkr)}</p>
        <p className="text-ink-soft">
          {kind === "buy" ? "paid for" : "received for"} {grams(txn.grams)} of gold
        </p>
      </>
    );
  }
  return <p className="font-display text-4xl font-bold">{grams(txn.grams)}</p>;
}

function Counterparty({ kind, txn }: { kind: Kind; txn: Transaction }) {
  if (kind === "buy") return <Row label="Paid from" value="Current account" />;
  if (kind === "sell") return <Row label="Paid into" value="Current account" />;
  const other: Customer | undefined = customerForWallet(
    kind === "in" ? txn.walletId : txn.counterpartyWalletId,
  );
  return <Row label={kind === "in" ? "From" : "To"} value={other?.name ?? "Another customer"} />;
}

function Charges({ kind, txn, quote }: { kind: "buy" | "sell"; txn: Transaction; quote?: Quote }) {
  const total = kind === "buy" ? "Total paid" : "You received";
  if (!quote) {
    return (
      <Section title="Price" note="The price breakdown is no longer available for this trade.">
        {txn.netAmountPkr ? <Row label={total} value={pkr(txn.netAmountPkr)} strong /> : null}
      </Section>
    );
  }
  return (
    <Section
      title="Price"
      note={`Price fixed when you asked for it, ${fullDate(quote.createdAt)}: gold ${usd(quote.price.xauUsd)} per troy ounce, US$ 1 = ${pkr(quote.price.usdPkr)}.`}
    >
      <Row label="Price per gram" value={pkr(quote.price.pricePerGramPkr)} />
      <Row label="Gold value" value={pkr(quote.grossAmountPkr)} />
      <Row
        label="Exchange margin"
        value={`${kind === "buy" ? "+" : "−"} ${pkr(quote.fees.fxMarginPkr)}`}
      />
      <Row label={total} value={pkr(quote.netAmountPkr)} strong />
    </Section>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold tracking-widest text-ink-soft uppercase">{title}</h2>
      <dl className="space-y-2">{children}</dl>
      {note ? <p className="pt-1 text-xs text-ink-soft">{note}</p> : null}
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div
      className={`flex justify-between gap-4 text-sm ${strong ? "border-t border-line pt-2 text-base font-semibold" : ""}`}
    >
      <dt className={strong ? "" : "text-ink-soft"}>{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
