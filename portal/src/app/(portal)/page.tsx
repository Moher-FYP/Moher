"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  describeChange,
  PeriodNote,
  PeriodPicker,
  SimulatedBanner,
  Tile,
  usePeriod,
} from "@/components/analytics";
import { LineChart, Waterfall, type WaterfallStep } from "@/components/charts";
import { useMe } from "@/components/Shell";
import { TransactionRows } from "@/components/TransactionRows";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, useLoad } from "@/components/ui";
import { api, type Analytics, type Overview } from "@/lib/api";
import {
  day,
  grams,
  gramsShort,
  gramsSigned,
  rupees,
  rupeesShort,
  seconds,
  share,
  when,
} from "@/lib/format";

export default function OverviewPage() {
  const me = useMe();
  const router = useRouter();
  const operator = me.user.role === "operator";
  useEffect(() => {
    if (operator) router.replace("/operator");
  }, [operator, router]);
  if (operator) return null;
  // The period lives in the address; reading it needs a Suspense boundary in Next 16.
  return (
    <Suspense fallback={<Loading />}>
      <OverviewBody partner={me.user.partner ?? ""} />
    </Suspense>
  );
}

function OverviewBody({ partner }: { partner: string }) {
  const days = usePeriod();
  const analytics = useLoad(() => api<Analytics>(`/analytics?days=${days}`), [days]);
  const overview = useLoad(() => api<Overview>("/overview"));
  const a = analytics.data;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={
          a ? (
            <>
              Gold Savings at {partner}, through MOHAR ·{" "}
              <PeriodNote from={a.period.from} until={a.period.until} previous={a.previousPeriod} />
            </>
          ) : (
            `Gold Savings at ${partner}, through MOHAR`
          )
        }
        actions={
          <>
            {overview.data?.reserve ? (
              <Badge tone={overview.data.reserve.fullyBacked ? "ok" : "bad"}>
                {overview.data.reserve.fullyBacked ? "Reserve fully backed" : "Reserve short"} ·{" "}
                {when(overview.data.reserve.asOf)}
              </Badge>
            ) : null}
            <PeriodPicker value={days} />
          </>
        }
      />
      {a?.simulated ? <SimulatedBanner /> : null}
      <ErrorBox error={analytics.error} />
      {analytics.loading && !a ? <Loading /> : null}
      {a ? (
        <div className="space-y-6">
          <Headline a={a} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Gold in custody, and the price">
              <CustodyAndPrice a={a} />
            </Card>
            <Card title="What moved the value of custody">
              <Bridge a={a} />
            </Card>
          </div>
        </div>
      ) : null}
      <div className="mt-6">
        <Card
          title="Latest transactions"
          action={
            <Link href="/transactions" className="text-sm font-medium text-navy hover:underline">
              View all
            </Link>
          }
        >
          <ErrorBox error={overview.error} />
          {overview.data ? (
            overview.data.latestTransactions.length ? (
              <TransactionRows rows={overview.data.latestTransactions} />
            ) : (
              <Empty>No transactions yet.</Empty>
            )
          ) : overview.loading ? (
            <Loading />
          ) : null}
        </Card>
      </div>
    </>
  );
}

function Headline({ a }: { a: Analytics }) {
  const t = a.tiles;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        label="Gold in custody"
        value={grams(t.custodyGrams.value, 2)}
        change={describeChange(t.custodyGrams)}
        note={`${rupees(t.custodyPkr.value.replace(/\.\d+$/, ".00"))} today`}
        definition="Gold your savers hold through MOHAR at the end of the period, allocated bar by bar in the vault. The rupee value uses today's price."
        href="/customers"
      />
      <Tile
        label="Net flow"
        value={gramsSigned(t.netFlowGrams.value, 2)}
        change={describeChange(t.netFlowGrams)}
        definition="Gold bought minus gold sold in the period, plus transfers in from other partners minus transfers out. Positive means savers are adding."
        href="/trading"
      />
      <Tile
        label="Active savers"
        value={t.activeSavers.value.toLocaleString("en")}
        change={describeChange(t.activeSavers)}
        note={`of ${a.savers.funded.toLocaleString("en")} holding gold`}
        definition="Savers with at least one confirmed buy, sale or transfer in the period."
        href="/customers"
      />
      <Tile
        label="Fees earned"
        value={rupees(t.feesPkr.value.replace(/\.\d+$/, ".00"))}
        change={describeChange(t.feesPkr)}
        definition="FX margin and platform fee on the confirmed buys and sales asked for in the period, as quoted to the saver."
      />
      <Tile
        label="Trading volume"
        value={rupeesShort(Number(t.volumePkr.value))}
        change={describeChange(t.volumePkr)}
        note={`${t.trades.value.toLocaleString("en")} trades`}
        definition="Rupees paid in for buys plus rupees paid out for sales, confirmed, asked for in the period."
        href="/trading"
      />
      <Tile
        label="Quote conversion"
        value={share(t.conversion.value)}
        change={describeChange(t.conversion, "points")}
        definition="Share of the quotes given in the period that became a confirmed trade. The rest expired, failed or are still open."
        href="/trading"
      />
      <Tile
        label="Reserve backing"
        value={a.reserve ? share(a.reserve.backingRatio, 2) : "—"}
        note={a.reserve ? `published ${when(a.reserve.asOf)}` : "no attestation yet"}
        better="neither"
        definition="Grams the vault attested in its latest Proof-of-Reserve, divided by MOHAR's token supply at that moment. Below 100% pauses buying."
        href="/limits"
      />
      <Tile
        label="Median settlement"
        value={seconds(t.settlementP50Ms.value)}
        change={describeChange(t.settlementP50Ms)}
        better="down"
        definition="Half of the buys and sales confirmed in the period settled on chain within this time, counted from the request to the confirmation."
        href="/trading"
      />
    </div>
  );
}

function CustodyAndPrice({ a }: { a: Analytics }) {
  const [hover, setHover] = useState<number | null>(null);
  const custody = a.series.map((d) => ({ label: day(d.date), value: Number(d.custodyGrams) }));
  const price = a.series.map((d) => ({ label: day(d.date), value: Number(d.pricePerGramPkr) }));
  const i = hover ?? a.series.length - 1;
  const point = a.series[i];
  return (
    <div>
      {point ? (
        <p className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-live="polite">
          <span className="text-ink-faint">{hover === null ? "Latest" : day(point.date)}</span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[2px] bg-navy" />
            <span className="font-semibold text-ink">{grams(point.custodyGrams, 2)}</span>
            <span className="text-ink-soft">in custody</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[2px] bg-gold" />
            <span className="font-semibold text-ink">
              {rupees(point.pricePerGramPkr.replace(/\.\d+$/, ".00"))}
            </span>
            <span className="text-ink-soft">per gram</span>
          </span>
        </p>
      ) : null}
      <LineChart
        data={custody}
        format={gramsShort}
        caption="Gold in custody at the end of each day"
        hover={hover}
        onHover={setHover}
        height={190}
        showDates={false}
      />
      <LineChart
        data={price}
        format={rupeesShort}
        caption="Price of one gram of gold in rupees at the end of each day"
        tone="gold"
        hover={hover}
        onHover={setHover}
        height={120}
      />
      <p className="mt-3 text-xs text-ink-faint">
        The price line explains most day-to-day swings in the rupee value of custody; the gold line
        moves only when savers buy, sell or transfer.
      </p>
    </div>
  );
}

function Bridge({ a }: { a: Analytics }) {
  const b = a.bridge;
  const n = (s: string) => Number(s);
  const steps: WaterfallStep[] = [
    { label: "Opening", value: n(b.openingPkr), total: true },
    { label: "Bought", value: n(b.boughtPkr) },
    { label: "Sold", value: -n(b.soldPkr) },
  ];
  const transfers = n(b.transferredInPkr) - n(b.transferredOutPkr);
  if (n(b.transferredInPkr) || n(b.transferredOutPkr))
    steps.push({ label: "Transfers", value: transfers });
  steps.push(
    { label: "Price", value: n(b.priceEffectPkr) },
    { label: "Closing", value: n(b.closingPkr), total: true },
  );
  return (
    <div>
      <Waterfall
        steps={steps}
        format={(v, signed) => (signed && v > 0 ? "+" : "") + rupeesShort(v)}
        axisFormat={rupeesShort}
        caption="Bridge from the rupee value of custody at the start of the period to the end"
      />
      <p className="mt-3 text-xs text-ink-faint">
        Closing equals opening, plus what savers bought, minus what they sold
        {steps.some((s) => s.label === "Transfers") ? ", plus net transfers" : ""}, plus the effect
        of the gold price on gold already held. Each figure is at the price of its own trade.
      </p>
    </div>
  );
}
