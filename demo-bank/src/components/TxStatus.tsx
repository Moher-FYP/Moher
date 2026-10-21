"use client";

import type { Transaction } from "@mohar/sdk";
import Link from "next/link";
import { useEffect, useState } from "react";

const FINAL = new Set(["confirmed", "failed"]);

const FAILURE_TEXT: Record<string, string> = {
  price_moved:
    "The gold price moved more than 0.5% before your trade settled, so it was cancelled. Nothing was charged. Get a new price and try again.",
  minting_paused: "New purchases are paused while the vault is reconciled. Try again later.",
  wallet_frozen: "Your Gold Savings account is on hold. Contact the bank.",
  insufficient_balance: "You don't have enough gold for this.",
};

const STEPS = [
  { key: "pending", label: "Request received" },
  { key: "submitted", label: "Settling on the ledger" },
  { key: "confirmed", label: "Done" },
] as const;

/** Polls the bank's own route handler (which asks MOHAR) until the trade settles. */
export function TxStatus({ initial }: { initial: Transaction }) {
  const [txn, setTxn] = useState(initial);

  useEffect(() => {
    if (FINAL.has(txn.status)) return;
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/tx/${txn.id}`, { cache: "no-store" });
      if (response.ok) setTxn((await response.json()) as Transaction);
    }, 800);
    return () => clearTimeout(timer);
  }, [txn]);

  if (txn.status === "failed") {
    return (
      <div role="status" className="rounded-2xl bg-danger-pale p-4 text-danger">
        <p className="font-semibold">Not completed</p>
        <p className="mt-1 text-sm">
          {FAILURE_TEXT[txn.failureCode ?? ""] ?? "The trade could not be completed. Try again."}
        </p>
      </div>
    );
  }

  const reached = STEPS.findIndex((s) => s.key === txn.status);
  return (
    <>
      <ol className="space-y-3" aria-live="polite">
        {STEPS.map((step, i) => (
          <li key={step.key} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={`grid size-7 place-items-center rounded-full text-sm font-bold ${
                i <= reached ? "bg-bank text-white" : "border border-line text-ink-soft"
              }`}
            >
              {i < reached || txn.status === "confirmed" ? "✓" : i + 1}
            </span>
            <span className={i <= reached ? "font-semibold" : "text-ink-soft"}>{step.label}</span>
          </li>
        ))}
      </ol>
      {txn.status === "confirmed" ? (
        <Link
          href={`/tx/${txn.id}/receipt`}
          className="block text-center font-semibold text-bank underline-offset-2 hover:underline"
        >
          View receipt
        </Link>
      ) : null}
    </>
  );
}
