"use client";

import Link from "next/link";
import { Suspense } from "react";
import {
  describeChange,
  PeriodNote,
  PeriodPicker,
  SimulatedBanner,
  Tile,
  usePeriod,
} from "@/components/analytics";
import { FlowBars, Histogram, ShareBars, type ShareRow } from "@/components/charts";
import { useMe } from "@/components/Shell";
import { Card, Empty, ErrorBox, Loading, PageHeader, useLoad } from "@/components/ui";
import { api, type Analytics } from "@/lib/api";
import { day, gramsShort, rupees, rupeesK, rupeesShort, seconds, share } from "@/lib/format";

/** Plain names for the failure codes a partner is likely to see (the spec's Error.code). */
const REASONS: Record<string, string> = {
  price_moved: "Price moved more than 0.5% before settlement",
  quote_expired: "Quote expired before the trade was sent",
  minting_paused: "Buying paused (reserve shortfall)",
  limit_exceeded: "Over the saver's KYC limit",
  wallet_frozen: "Wallet frozen",
  wallet_not_registered: "Wallet not registered",
  insufficient_balance: "Not enough gold to sell",
  internal_error: "MOHAR internal error",
  unknown: "Other",
};

export default function TradingPage() {
  const me = useMe();
  return (
    <Suspense fallback={<Loading />}>
      <TradingBody partner={me.user.partner ?? ""} />
    </Suspense>
  );
}

function TradingBody({ partner }: { partner: string }) {
  const days = usePeriod();
  const {
    data: a,
    error,
    loading,
  } = useLoad(() => api<Analytics>(`/analytics?days=${days}`), [days]);

  return (
    <>
      <PageHeader
        title="Trading"
        subtitle={
          a ? (
            <>
              Buys and sales by {partner}&apos;s savers ·{" "}
              <PeriodNote from={a.period.from} until={a.period.until} previous={a.previousPeriod} />
            </>
          ) : (
            `Buys and sales by ${partner}'s savers`
          )
        }
        actions={<PeriodPicker value={days} />}
      />
      {a?.simulated ? <SimulatedBanner /> : null}
      <ErrorBox error={error} />
      {loading && !a ? <Loading /> : null}
      {a ? (
        <div className="space-y-6">
          <Headline a={a} />
          <Card
            title="Gold bought and sold each day"
            action={
              <Link
                href="/transactions?status=confirmed"
                className="text-sm font-medium text-navy hover:underline"
              >
                Confirmed trades
              </Link>
            }
          >
            <FlowBars
              data={a.series.map((d) => ({
                label: day(d.date),
                up: Number(d.boughtGrams),
                down: Number(d.soldGrams),
                net: Number(d.netGrams),
              }))}
              format={gramsShort}
              caption="Grams bought, sold and net per day"
            />
          </Card>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="What became of the quotes">
              <Funnel a={a} />
            </Card>
            <Card title="Size of each buy">
              <Tickets a={a} />
            </Card>
          </div>
          <Card title="Time to settle">
            <Settlement a={a} />
          </Card>
        </div>
      ) : null}
    </>
  );
}

function Headline({ a }: { a: Analytics }) {
  const t = a.tiles;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Tile
        label="Trading volume"
        value={rupeesShort(Number(t.volumePkr.value))}
        change={describeChange(t.volumePkr)}
        definition="Rupees paid in for buys plus rupees paid out for sales, confirmed, asked for in the period."
        href="/transactions?status=confirmed"
      />
      <Tile
        label="Trades"
        value={t.trades.value.toLocaleString("en")}
        change={describeChange(t.trades)}
        definition="Confirmed buys and sales asked for in the period. Transfers between partners are not trades."
        href="/transactions?status=confirmed"
      />
      <Tile
        label="Median buy"
        value={
          t.medianTicketPkr.value ? rupees(t.medianTicketPkr.value.replace(/\.\d+$/, ".00")) : "—"
        }
        change={describeChange(t.medianTicketPkr)}
        better="neither"
        definition="Half of the confirmed buys in the period were for this many rupees or less. The median is not pulled up by a few large buys, as the average is."
        href="/transactions?type=mint&status=confirmed"
      />
      <Tile
        label="Quote conversion"
        value={share(t.conversion.value)}
        change={describeChange(t.conversion, "points")}
        definition="Share of the quotes given in the period that became a confirmed trade."
      />
      <Tile
        label="Price-band cancellations"
        value={share(t.bandCancellationRate.value, 2)}
        change={describeChange(t.bandCancellationRate, "points")}
        better="down"
        definition="Share of finished buys and sales that the token contract cancelled because the gold price moved more than 0.5% between the quote and settlement. The saver is not charged."
        href="/transactions?status=failed"
      />
      <Tile
        label="Median settlement"
        value={seconds(t.settlementP50Ms.value)}
        change={describeChange(t.settlementP50Ms)}
        better="down"
        definition="Half of the buys and sales confirmed in the period settled on chain within this time, counted from the request to the confirmation."
      />
    </div>
  );
}

function Funnel({ a }: { a: Analytics }) {
  const f = a.funnel;
  if (!f.quotes) return <Empty>No quotes in this period.</Empty>;
  const rows: ShareRow[] = [
    { label: "Traded", count: f.traded, tone: "ok", note: "confirmed on chain" },
    {
      label: "Expired",
      count: f.expired,
      tone: "faint",
      note: "saver did not go ahead within 60 s",
    },
    { label: "Failed", count: f.failed, tone: "bad" },
    ...(f.pending
      ? [
          {
            label: "Pending",
            count: f.pending,
            tone: "warn" as const,
            note: "sent, not yet confirmed",
          },
        ]
      : []),
    ...(f.open ? [{ label: "Still open", count: f.open, tone: "navy" as const }] : []),
  ];
  return (
    <div>
      <p className="mb-4 text-sm text-ink-soft">
        <span className="font-semibold text-ink">{f.quotes.toLocaleString("en")}</span> quotes
        given. Each locks the price for 60 seconds.
      </p>
      <ShareBars rows={rows} total={f.quotes} caption="Outcome of each quote" />
      {f.failureReasons.length ? (
        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
            Why trades failed
          </p>
          <ul className="space-y-1.5 text-sm">
            {f.failureReasons.map((r) => (
              <li key={r.code} className="flex justify-between gap-3">
                <span className="text-ink">
                  {REASONS[r.code] ?? r.code}{" "}
                  <span className="mono text-xs text-ink-faint">{r.code}</span>
                </span>
                <span className="tabular-nums font-semibold text-ink">
                  {r.count.toLocaleString("en")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Tickets({ a }: { a: Analytics }) {
  const t = a.tickets;
  if (!t.count) return <Empty>No confirmed buys in this period.</Empty>;
  const median = Number(t.medianPkr);
  const highlight = t.bins.findIndex(
    (b) => median >= Number(b.minPkr) && (b.maxPkr === undefined || median < Number(b.maxPkr)),
  );
  const whole = (s: string | null) => (s ? rupees(s.replace(/\.\d+$/, ".00")) : "—");
  return (
    <div>
      <p className="mb-4 text-sm text-ink-soft">
        {t.count.toLocaleString("en")} buys · median{" "}
        <span className="font-semibold text-ink">{whole(t.medianPkr)}</span> · average{" "}
        <span className="font-semibold text-ink">{whole(t.meanPkr)}</span>
      </p>
      <Histogram
        bins={t.bins.map((b) => ({
          label:
            b.maxPkr === undefined
              ? `${rupeesK(b.minPkr)}+`
              : `${rupeesK(b.minPkr)}–${rupeesK(b.maxPkr)}`,
          count: b.count,
        }))}
        highlight={highlight >= 0 ? highlight : undefined}
        caption="Number of buys by size in rupees"
      />
      <p className="mt-3 text-xs text-ink-faint">
        Rupees per buy (k = thousand). The gold bar holds the median buy. An average well above the
        median means a few large buys and many small ones, which is what a savings product should
        see.
      </p>
    </div>
  );
}

function Settlement({ a }: { a: Analytics }) {
  const s = a.settlement;
  if (!s.count) return <Empty>No buys or sales settled in this period.</Empty>;
  const items = [
    { label: "Half settled within", value: seconds(s.p50Ms), note: "median (p50)" },
    { label: "95 in 100 settled within", value: seconds(s.p95Ms), note: "p95" },
    { label: "Slowest", value: seconds(s.maxMs), note: "max" },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.label}>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{i.label}</p>
          <p className="mt-1 font-display text-2xl font-extrabold tracking-[-0.02em] tabular-nums text-ink">
            {i.value}
          </p>
          <p className="text-xs text-ink-soft">{i.note}</p>
        </div>
      ))}
      <p className="text-sm text-ink-soft sm:border-l sm:border-line sm:pl-4">
        {s.count.toLocaleString("en")} trades, from the request to confirmation on chain. Each buy
        or sale settles in one transaction, so a saver holds the gold the moment it confirms.
      </p>
    </div>
  );
}
