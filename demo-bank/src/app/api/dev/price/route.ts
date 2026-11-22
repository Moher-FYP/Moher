import { getMoharQuiet } from "@/lib/mohar";

/** The gold price for the "Behind the scenes" panel's price-band demo. Not logged as a call. */
export async function GET() {
  try {
    const price = await getMoharQuiet().getPrice();
    return Response.json(
      { xauUsd: price.xauUsd, pricePerGramPkr: price.pricePerGramPkr, asOf: price.asOf },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Price not available" }, { status: 502 });
  }
}
