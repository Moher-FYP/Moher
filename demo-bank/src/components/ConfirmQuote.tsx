"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, primaryButton, quietButton } from "./kit";
import { useSecondsLeft } from "./QuoteCountdown";

/**
 * The confirm button. Once the held price runs out it is replaced by a way back to get a new
 * one: MOHAR would refuse the expired quote anyway. `children` are extra fields (pay with).
 */
export function ConfirmQuote({
  quoteId,
  expiresAt,
  label,
  againHref,
  action,
  children,
}: {
  quoteId: string;
  expiresAt: string;
  label: string;
  againHref: string;
  action: (formData: FormData) => Promise<void>;
  children?: ReactNode;
}) {
  const expired = useSecondsLeft(expiresAt) === 0;
  return (
    <form action={action} className="flex flex-1 flex-col">
      <input type="hidden" name="quoteId" value={quoteId} />
      {children}
      <div className="mt-auto flex flex-col gap-2.5 px-5 pt-3 pb-7">
        <p
          className="mb-0.5 text-center text-[13px] leading-[1.45] text-ink-soft"
          aria-live="polite"
        >
          {expired
            ? "This price has expired. Get a new one; nothing was charged."
            : "If gold moves more than 0.5% before it settles, the trade is cancelled and nothing is charged."}
        </p>
        {expired ? (
          <Link href={againHref} className={primaryButton}>
            <Icon name="refresh" size={20} />
            Get a new price
          </Link>
        ) : (
          <button type="submit" className={primaryButton}>
            <Icon name="lock" size={20} />
            {label}
          </button>
        )}
        <Link href="/" className={quietButton}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
