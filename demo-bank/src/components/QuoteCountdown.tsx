"use client";

import { useEffect, useState } from "react";

/** Seconds left on a held price, ticking. */
export function useSecondsLeft(expiresAt: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
}

/** "Price held for 0:42" chip, with the seal-orange dot; says so when the price expires. */
export function QuoteChip({ expiresAt }: { expiresAt: string }) {
  const left = useSecondsLeft(expiresAt);
  const text = left
    ? `Price held for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`
    : "Price expired";
  return (
    <span
      role="timer"
      aria-live={left % 15 === 0 ? "polite" : "off"}
      className="ring-line inline-flex items-center gap-2 rounded-full bg-surface px-3 py-[7px] text-[13px] font-bold text-ink"
    >
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${left ? "bg-seal shadow-[0_0_0_4px_#ff6a132e]" : "bg-ink-faint"}`}
      />
      {text}
    </span>
  );
}
