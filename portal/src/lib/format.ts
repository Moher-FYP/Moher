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
