import "server-only";
import type { Quote } from "@mohar/sdk";

/**
 * Quotes the bank has shown its customers, so the confirm screen can re-display them.
 * MOHAR returns a quote once, at creation; keeping it is the partner's job.
 */
const globalQuotes = globalThis as typeof globalThis & {
  __demoQuotes?: Map<string, { quote: Quote; customerId: string }>;
};
const quotes = (globalQuotes.__demoQuotes ??= new Map());

export function rememberQuote(quote: Quote, customerId: string): void {
  quotes.set(quote.id, { quote, customerId });
}

export function recallQuote(quoteId: string, customerId: string): Quote | undefined {
  const entry = quotes.get(quoteId);
  return entry && entry.customerId === customerId ? entry.quote : undefined;
}
