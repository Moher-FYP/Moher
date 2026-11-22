"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BigFigure, Icon } from "./kit";

export type AmountMode = "pkr" | "grams";

const MODES: Record<
  AmountMode,
  { name: string; prefix?: string; suffix?: string; places: number; whole: number; tab: string }
> = {
  // The field names the server actions read (app/actions.ts).
  pkr: { name: "amountPkr", prefix: "Rs", places: 0, whole: 8, tab: "Rupees" },
  grams: { name: "grams", suffix: "g", places: 4, whole: 4, tab: "Grams" },
};

const rupees = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });

/** "12500.5" -> "12,500.5" while typing (keeps a trailing point or zeros). */
function display(raw: string): string {
  if (!raw) return "0";
  const [whole = "0", fraction] = raw.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/**
 * Money and gold are typed on the app's own pad, so the figure never hides behind a phone's
 * keyboard (Components board: "Number pad"). A laptop keyboard works too: digits, the point and
 * Backspace. The value reaches the server action through a hidden field.
 */
export function AmountPad({
  modes,
  labels,
  pricePerGramPkr,
  destination,
  initial = "",
  presets = [],
  children,
}: {
  /** One mode, or two to show a Grams / Rupees switch (the first is the default). */
  modes: AmountMode[];
  /** The figure's label in each mode, e.g. { pkr: "Amount to spend" }. */
  labels: Partial<Record<AmountMode, string>>;
  /** Today's price, for the estimate under the figure. The quote fixes the real one. */
  pricePerGramPkr: number;
  /** Where rupees go, for a sale: "to your current account". */
  destination?: string;
  initial?: string;
  /** Quick amounts, in rupees (pkr mode only). */
  presets?: number[];
  /** Rendered between the figure and the pad (for example the "pay from" row). */
  children?: ReactNode;
}) {
  const [mode, setMode] = useState<AmountMode>(modes[0] ?? "pkr");
  const unit = MODES[mode];
  const [raw, setRaw] = useState(initial);

  const press = (key: string) =>
    setRaw((current) => {
      if (key === "del") return current.slice(0, -1);
      if (key === ".") {
        if (unit.places === 0 || current.includes(".")) return current;
        return current ? `${current}.` : "0.";
      }
      const next = current === "0" ? key : current + key;
      const [whole = "", fraction] = next.split(".");
      if (whole.length > unit.whole) return current;
      if (fraction !== undefined && fraction.length > unit.places) return current;
      return next;
    });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^[0-9]$/.test(event.key)) press(event.key);
      else if (event.key === "." || event.key === ",") press(".");
      else if (event.key === "Backspace") press("del");
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // press reads the unit of the mode it was made for
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const value = Number(raw || "0");
  const conversion =
    mode === "pkr"
      ? `≈ ${(value / pricePerGramPkr).toFixed(4)} g of ${destination ? "your" : "24K"} gold, at Rs ${rupees.format(pricePerGramPkr)} per gram`
      : `≈ Rs ${rupees.format(value * pricePerGramPkr)}${destination ? ` ${destination}` : ""}`;
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"];

  return (
    <>
      <input type="hidden" name={unit.name} value={raw.replace(/\.$/, "")} />
      <div className="flex flex-col gap-4 px-5 pt-1 pb-2">
        {modes.length > 1 ? (
          <div
            role="group"
            aria-label="Amount in"
            className="ring-line grid grid-cols-2 gap-1 rounded-full bg-surface p-1"
          >
            {modes.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={m === mode}
                onClick={() => {
                  setMode(m);
                  setRaw("");
                }}
                className={`h-[38px] rounded-full text-sm font-bold ${
                  m === mode ? "bg-primary text-on-primary" : "text-ink-soft hover:text-ink"
                }`}
              >
                {MODES[m].tab}
              </button>
            ))}
          </div>
        ) : null}
        <BigFigure
          label={labels[mode] ?? ""}
          prefix={unit.prefix}
          suffix={unit.suffix}
          value={display(raw)}
          conversion={conversion}
          caret
        />
        {presets.length && mode === "pkr" ? (
          <div role="group" aria-label="Quick amounts" className="grid grid-cols-4 gap-2">
            {presets.map((preset) => {
              const on = preset === value && raw !== "";
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setRaw(String(preset))}
                  className={`h-10 rounded-full text-sm font-bold ${
                    on
                      ? "bg-primary text-on-primary shadow-[inset_0_0_0_1.5px_var(--color-primary)]"
                      : "ring-line-strong bg-surface text-ink hover:bg-page"
                  }`}
                >
                  Rs {preset >= 10000 ? `${preset / 1000}k` : rupees.format(preset)}
                </button>
              );
            })}
          </div>
        ) : null}
        {children}
      </div>
      <div className="mt-auto px-5 pt-2">
        <div role="group" aria-label="Number pad" className="grid grid-cols-3 gap-0.5 pb-1.5">
          {keys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => press(key)}
              aria-label={key === "del" ? "Delete" : key === "." ? "Decimal point" : undefined}
              disabled={key === "." && unit.places === 0}
              className="grid h-[54px] place-items-center rounded-2xl font-display text-[26px] font-bold text-ink hover:bg-surface active:bg-line disabled:opacity-0"
            >
              {key === "del" ? <Icon name="del" size={24} /> : key}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
