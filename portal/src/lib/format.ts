/** Display helpers. Amounts arrive as decimal strings and are never turned into floats for maths. */

/** "25000.00" -> "Rs 25,000" (paisa shown only when there are some). */
export function rupees(value: string | undefined): string {
  if (value === undefined) return "—";
  const [whole = "0", fraction = "00"] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === "00" ? `Rs ${grouped}` : `Rs ${grouped}.${fraction}`;
}

/** "0.71557733" -> "0.7156 g" (4 places for reading; the full figure is in the title). */
export function grams(value: string | undefined, places = 4): string {
  if (value === undefined) return "—";
  const [whole = "0", fraction = ""] = value.split(".");
  return `${whole}.${fraction.padEnd(places, "0").slice(0, places)} g`;
}

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Karachi",
});

export function when(iso: string | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : "—";
}

/** "0x0610…e26c" */
export function short(value: string | undefined, head = 6, tail = 4): string {
  if (!value) return "—";
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Share of a limit used, 0–100, from two decimal strings. */
export function percent(used: string, limit: string): number {
  const u = Number(used);
  const l = Number(limit);
  return l > 0 ? Math.min(100, Math.round((u / l) * 100)) : 0;
}

export const KYC_NAMES: Record<string, string> = {
  asaan: "Asaan",
  standard: "Standard",
  enhanced: "Enhanced",
};

export const TYPE_NAMES: Record<string, string> = {
  mint: "Buy",
  burn: "Sell",
  transfer: "Transfer",
};

/** Rupees for a chart axis or a tile: "Rs 4.2M", "Rs 950k", "Rs 12,400". Signed. */
export function rupeesShort(value: number): string {
  const sign = value < 0 ? "−" : "";
  const v = Math.abs(value);
  if (v >= 1e7) return `${sign}Rs ${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e6) return `${sign}Rs ${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e4) return `${sign}Rs ${Math.round(v / 1e3).toLocaleString("en")}k`;
  return `${sign}Rs ${Math.round(v).toLocaleString("en")}`;
}

/** Signed rupees from a decimal string, whole rupees: "−Rs 1,250". */
export function rupeesSigned(value: string): string {
  const negative = value.startsWith("-");
  const text = rupees(negative ? value.slice(1) : value).replace(/\.\d+$/, "");
  return negative ? `−${text}` : `+${text}`;
}

/** Signed grams from a decimal string: "+1.2500 g", "−0.0310 g". */
export function gramsSigned(value: string, places = 4): string {
  const negative = value.startsWith("-");
  const text = grams(negative ? value.slice(1) : value, places);
  return `${negative ? "−" : "+"}${text}`;
}

/** A share 0–1 as a percentage: "87.4%"; "—" when there was nothing to divide by. */
export function share(value: number | null, places = 1): string {
  return value === null ? "—" : `${(value * 100).toFixed(places)}%`;
}

/** Milliseconds as seconds: "2.4 s". */
export function seconds(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`;
}

/** "2026-11-20" -> "20 Nov" */
export function day(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(Date.UTC(y!, m! - 1, d!));
}

/** Grams for a chart axis or tooltip: "1,234 g", "56.8 g", "0.412 g". Signed. */
export function gramsShort(value: number): string {
  const sign = value < 0 ? "−" : "";
  const v = Math.abs(value);
  if (v === 0) return "0 g";
  const places = v >= 1000 ? 0 : v >= 10 ? 1 : v >= 0.1 ? 2 : 3;
  return `${sign}${v.toLocaleString("en", { minimumFractionDigits: places, maximumFractionDigits: places })} g`;
}

/** Rupees in thousands for tight labels: 500 -> "500", 1000 -> "1k", 25000 -> "25k". */
export function rupeesK(value: string | number): string {
  const v = Number(value);
  return v >= 1000
    ? `${(v / 1000).toLocaleString("en", { maximumFractionDigits: 1 })}k`
    : String(Math.round(v));
}
