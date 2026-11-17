"use client";

import type { ReactNode } from "react";
import { QuoteCountdown } from "./QuoteCountdown";
import { primaryButton } from "./ui";

/** The confirm button, disabled once the held price expires. `children` are extra fields. */
export function ConfirmQuote({
  quoteId,
  expiresAt,
  label,
  action,
  children,
}: {
  quoteId: string;
  expiresAt: string;
  label: string;
  action: (formData: FormData) => Promise<void>;
  children?: ReactNode;
}) {
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="quoteId" value={quoteId} />
      {children}
      <QuoteCountdown expiresAt={expiresAt}>
        {(expired) => (
          <button type="submit" disabled={expired} className={primaryButton}>
            {label}
          </button>
        )}
      </QuoteCountdown>
    </form>
  );
}
