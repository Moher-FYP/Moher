"use client";

import { useEffect, useState } from "react";

/** Seconds left on a held price; disables the confirm button when it runs out. */
export function QuoteCountdown({
  expiresAt,
  children,
}: {
  expiresAt: string;
  children: (expired: boolean) => React.ReactNode;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const secondsLeft = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
  const expired = secondsLeft === 0;

  return (
    <>
      <p className="text-center text-sm text-ink-soft" aria-live="polite">
        {expired
          ? "This price has expired. Go back to get a new one."
          : `Price held for ${secondsLeft} seconds`}
      </p>
      {children(expired)}
    </>
  );
}
