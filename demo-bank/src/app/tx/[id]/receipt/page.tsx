import type { Quote, Transaction } from "@mohar/sdk";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { BackHeader, Chip, Rows, Wordmark, quietButton } from "@/components/kit";
import { PrintButton } from "@/components/PrintButton";
import type { Customer } from "@/lib/customers";
import { exactGrams, fullDate, gramsFigure, pkr, shortHash, usd } from "@/lib/format";
import { getMohar } from "@/lib/mohar";
import { partner } from "@/lib/partner";
import { PAYMENT_NOT_RECORDED, paymentFor } from "@/lib/payments";
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
  const kind: Kind =
    txn.type === "mint" ? "buy" : txn.type === "burn" ? "sell" : incoming ? "in" : "out";
  const settledAt = txn.confirmedAt ?? txn.createdAt;
  const dash = <div className="mt-4 mb-1 border-t border-dashed border-line" />;

  return (
    <>
      <BackHeader title="Receipt" backHref={`/tx/${txn.id}`} />
      <div className="flex flex-col gap-3.5 px-5 pt-2 pb-7">
        <article
          aria-labelledby="receipt-title"
          className="ring-line rounded-[26px] bg-surface px-5 pt-[22px] pb-[18px] print:shadow-none"
        >
          <div className="flex items-center justify-between">
            <Wordmark word={partner().word} size={20} />
            <Chip tone="bg-ok-pale text-ok">Settled</Chip>
          </div>
          <h1 id="receipt-title" className="mt-[18px] text-[13px] text-ink-soft">
            {HEADINGS[kind]} · {fullDate(settledAt)}
          </h1>
          <p
            className="mt-1 font-display text-[38px] font-extrabold tracking-[-0.035em]"
            title={exactGrams(txn.grams)}
          >
            {gramsFigure(txn.grams)} g
          </p>
          {kind === "buy" || kind === "sell" ? (
            <>
              {dash}
              <Charges kind={kind} txn={txn} quote={quote} />
            </>
          ) : null}
          {dash}
          <Rows
            items={[
              ...counterparty(kind, txn),
              ["Customer", customer.name] as [ReactNode, ReactNode],
              ["Gold", `${HELD[kind]} · 24 karat`],
              [
                "Exact quantity",
                <span key="q" className="font-mono text-[13px]">
                  {exactGrams(txn.grams)}
                </span>,
              ],
              ["Settlement", "Spot, in one ledger transaction"],
              [
                "Receipt number",
                <span key="n" className="font-mono text-[13px]">
                  {txn.id}
                </span>,
              ],
              ...(txn.txHash
                ? [
                    [
                      "Ledger reference",
                      txn.explorerUrl ? (
                        <a
                          key="h"
                          href={txn.explorerUrl}
                          className="font-mono text-[13px] underline"
                        >
                          {shortHash(txn.txHash)} ↗
                        </a>
                      ) : (
                        <span key="h" className="font-mono text-[13px]">
                          {shortHash(txn.txHash)}
                        </span>
                      ),
                    ] as [ReactNode, ReactNode],
                  ]
                : []),
            ]}
          />
          <p className="mt-3 text-xs leading-normal text-ink-soft">
            {quote
              ? `Price fixed when you asked for it, ${fullDate(quote.createdAt)}: gold ${usd(quote.price.xauUsd)} per troy ounce, US$ 1 = ${pkr(quote.price.usdPkr)}. `
              : ""}
            No interest is charged or paid. Gold provided by MOHAR, held for you by its custodian;
            check it any time on{" "}
            <Link href="/verify" className="font-semibold text-ink underline">
              Gold in the vault
            </Link>
            .
          </p>
        </article>
        <div className="flex flex-col gap-2.5 print:hidden">
          <PrintButton />
          <Link href="/" className={quietButton}>
            Back to home
          </Link>
        </div>
      </div>
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

function counterparty(kind: Kind, txn: Transaction): [ReactNode, ReactNode][] {
  // How the partner moved the rupees. Not known after a restart: then its own account.
  const paid = paymentFor(txn.id)?.label ?? PAYMENT_NOT_RECORDED;
  if (kind === "buy") return [["Paid from", paid]];
  if (kind === "sell") return [["Paid into", paid]];
  const other: Customer | undefined = customerForWallet(
    kind === "in" ? txn.walletId : txn.counterpartyWalletId,
  );
  return [[kind === "in" ? "From" : "To", other?.name ?? "Another customer"]];
}

function Charges({ kind, txn, quote }: { kind: "buy" | "sell"; txn: Transaction; quote?: Quote }) {
  const total = kind === "buy" ? "Total paid" : "You received";
  if (!quote) {
    return (
      <>
        {txn.netAmountPkr ? <Rows items={[]} total={[total, pkr(txn.netAmountPkr)]} /> : null}
        <p className="mt-2 text-xs text-ink-soft">
          The price breakdown is no longer available for this trade.
        </p>
      </>
    );
  }
  return (
    <Rows
      items={[
        ["Price per gram", pkr(quote.price.pricePerGramPkr)],
        [kind === "buy" ? "Gold value" : "Sale value", pkr(quote.grossAmountPkr)],
        ["Exchange margin", `${kind === "buy" ? "+" : "−"} ${pkr(quote.fees.fxMarginPkr)}`],
      ]}
      total={[total, pkr(quote.netAmountPkr)]}
    />
  );
}
