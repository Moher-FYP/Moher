import { divCeil } from "./money.js";

/**
 * Gold pricing. All inputs and outputs are bigint fixed-point:
 *   xauUsdE8   USD per troy ounce × 10^8 (Chainlink format, read on-chain)
 *   usdPkrE4   PKR per USD × 10^4 (off-chain rate; there is no PKR feed on Polygon)
 *   grams      × 10^8
 *   PKR        in paisa (× 10^2)
 *
 * Rounding always favours the reserve: the customer never receives more gold or rupees than
 * the oracle price justifies, and is never charged less.
 */

/** 1 troy ounce = 31.1035 g, scaled by 10^4. Matches MoharTypes.GRAMS_PER_TROY_OUNCE_E4. */
export const GRAMS_PER_OUNCE_E4 = 311_035n;
const E8 = 100_000_000n;
const PAISA_PER_PKR = 100n;
const BPS = 10_000n;

export interface PriceInputs {
  xauUsdE8: bigint;
  usdPkrE4: bigint;
}

/** paisa = grams × (USD/oz) × (PKR/USD) ÷ (g/oz) */
function paisaForGrams(grams: bigint, p: PriceInputs, roundUp: boolean): bigint {
  const numerator = grams * p.xauUsdE8 * p.usdPkrE4 * PAISA_PER_PKR;
  const denominator = E8 * E8 * GRAMS_PER_OUNCE_E4;
  return roundUp ? divCeil(numerator, denominator) : numerator / denominator;
}

/** grams = paisa ÷ price per gram */
function gramsForPaisa(paisa: bigint, p: PriceInputs, roundUp: boolean): bigint {
  const numerator = paisa * E8 * E8 * GRAMS_PER_OUNCE_E4;
  const denominator = PAISA_PER_PKR * p.xauUsdE8 * p.usdPkrE4;
  return roundUp ? divCeil(numerator, denominator) : numerator / denominator;
}

/** Price of one gram in paisa (for display). */
export function pricePerGramPaisa(p: PriceInputs): bigint {
  return paisaForGrams(E8, p, false);
}

/** Value of a gold balance in paisa (for display; rounds down). */
export function valuePaisa(grams: bigint, p: PriceInputs): bigint {
  return paisaForGrams(grams, p, false);
}

export interface FeeRates {
  /** Charged to the partner institution (ujrah), not the customer. */
  platformFeeBps: bigint;
  /** Built into the customer's price (capped FX margin, FYP-1 §2.2.6). */
  fxMarginBps: bigint;
}

export type QuoteSide = "buy" | "sell";

export type QuoteAmount =
  { amountPaisa: bigint; grams?: undefined } | { grams: bigint; amountPaisa?: undefined };

export interface QuoteMath {
  grams: bigint;
  /** Gold value at the oracle price. */
  grossPaisa: bigint;
  /** What the customer pays (buy) or receives (sell). */
  netPaisa: bigint;
  fxMarginPaisa: bigint;
  platformFeePaisa: bigint;
}

export class QuoteTooSmallError extends Error {}

/**
 * Buy:  customer pays net = gross + FX margin.
 * Sell: customer receives net = gross − FX margin.
 * The amount may be given in PKR (net, what the customer pays or wants to receive) or in grams.
 */
export function computeQuote(
  side: QuoteSide,
  amount: QuoteAmount,
  price: PriceInputs,
  fees: FeeRates,
): QuoteMath {
  let grams: bigint;
  let grossPaisa: bigint;
  let netPaisa: bigint;

  if (side === "buy") {
    if (amount.amountPaisa !== undefined) {
      netPaisa = amount.amountPaisa;
      grossPaisa = (netPaisa * BPS) / (BPS + fees.fxMarginBps);
      grams = gramsForPaisa(grossPaisa, price, false);
    } else {
      grams = amount.grams;
      grossPaisa = paisaForGrams(grams, price, true);
      netPaisa = grossPaisa + divCeil(grossPaisa * fees.fxMarginBps, BPS);
    }
  } else {
    if (amount.amountPaisa !== undefined) {
      netPaisa = amount.amountPaisa;
      grossPaisa = divCeil(netPaisa * BPS, BPS - fees.fxMarginBps);
      grams = gramsForPaisa(grossPaisa, price, true);
    } else {
      grams = amount.grams;
      grossPaisa = paisaForGrams(grams, price, false);
      netPaisa = grossPaisa - divCeil(grossPaisa * fees.fxMarginBps, BPS);
    }
  }

  if (grams <= 0n || netPaisa <= 0n) {
    throw new QuoteTooSmallError("Amount is too small to trade");
  }
  return {
    grams,
    grossPaisa,
    netPaisa,
    fxMarginPaisa: side === "buy" ? netPaisa - grossPaisa : grossPaisa - netPaisa,
    platformFeePaisa: (grossPaisa * fees.platformFeeBps) / BPS,
  };
}
