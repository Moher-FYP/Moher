"use client";

import { Badge, Card, ErrorBox, Loading, PageHeader, Table, Td, useLoad } from "@/components/ui";
import { api, type Limits, type Overview } from "@/lib/api";
import { KYC_NAMES, rupees, when } from "@/lib/format";

export default function LimitsPage() {
  const limits = useLoad(() => api<Limits>("/limits"));
  const overview = useLoad(() => api<Overview>("/overview"));
  const reserve = overview.data?.reserve;

  return (
    <>
      <PageHeader
        title="Limits and reserve"
        subtitle="What each KYC level may receive, and whether every gram your customers hold is in the vault."
      />
      <div className="space-y-6">
        <Card
          title="KYC limits"
          action={<Badge>Set by MOHAR, modelled on the State Bank&apos;s account levels</Badge>}
        >
          <ErrorBox error={limits.error} />
          {limits.loading ? <Loading /> : null}
          {limits.data ? (
            <Table
              head={["Level", "Per trade", "Per 24 hours", "Per 30 days", "Most held", "Customers"]}
            >
              {limits.data.levels.map((l) => (
                <tr key={l.level}>
                  <Td className="font-medium">{KYC_NAMES[l.level]}</Td>
                  <Td>{rupees(l.perTradePkr)}</Td>
                  <Td>{rupees(l.per24HoursPkr)}</Td>
                  <Td>{rupees(l.per30DaysPkr)}</Td>
                  <Td>{rupees(l.maxHoldingPkr)}</Td>
                  <Td>{l.customers}</Td>
                </tr>
              ))}
            </Table>
          ) : null}
        </Card>
        <Card title="Proof of reserve">
          <ErrorBox error={overview.error} />
          {reserve ? (
            <div className="flex items-center gap-3">
              <Badge tone={reserve.fullyBacked ? "ok" : "bad"}>
                {reserve.fullyBacked ? "Fully backed" : "Short"}
              </Badge>
              <span className="text-sm text-ink-soft">
                Latest attestation {when(reserve.asOf)}. The vault signs its total and a Merkle root
                of every holding after each trade; the ReserveRegistry contract checks it on
                Polygon, and stops new purchases if the vault ever holds less than customers own.
              </span>
            </div>
          ) : overview.loading ? (
            <Loading />
          ) : (
            <p className="text-sm text-ink-soft">No attestation published yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}
