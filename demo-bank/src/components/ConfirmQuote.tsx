"use client";

import { QuoteCountdown } from "./QuoteCountdown";
import { primaryButton } from "./ui";

/** The confirm button, disabled once the held price expires. */
export function ConfirmQuote({
  quoteId,
  expiresAt,
  label,
  action,
}: {
  quoteId: string;
  expiresAt: string;
  label: string;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="quoteId" value={quoteId} />
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
