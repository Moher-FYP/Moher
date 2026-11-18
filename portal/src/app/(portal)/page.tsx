"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useMe } from "@/components/Shell";
import { TransactionRows } from "@/components/TransactionRows";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, Stat, useLoad } from "@/components/ui";
import { api, type Overview } from "@/lib/api";
import { grams, rupees, when } from "@/lib/format";

export default function OverviewPage() {
  const me = useMe();
  const router = useRouter();
  const operator = me.user.role === "operator";
  useEffect(() => {
    if (operator) router.replace("/operator");
  }, [operator, router]);
  const { data, error, loading } = useLoad(
    () => (operator ? Promise.resolve(undefined) : api<Overview>("/overview")),
    [operator],
  );
  if (operator) return null;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`Gold Savings at ${me.user.partner}, through MOHAR`}
        actions={
          data?.reserve ? (
            <Badge tone={data.reserve.fullyBacked ? "ok" : "bad"}>
              {data.reserve.fullyBacked ? "Reserve fully backed" : "Reserve short"} ·{" "}
              {when(data.reserve.asOf)}
            </Badge>
          ) : null
        }
      />
      <ErrorBox error={error} />
      {loading ? <Loading /> : null}
      {data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Customers" value={data.customers} note="Gold Savings wallets" />
            <Stat
              label="Gold held"
              value={grams(data.goldHeldGrams)}
              note={`${rupees(data.goldHeldPkr)} at today's price`}
            />
            <Stat
              label="Volume, 30 days"
              value={rupees(data.volume30DaysPkr)}
              note="Confirmed buys and sells"
            />
            <Stat
              label="Failed, 7 days"
              value={data.failedLast7Days}
              note={data.failedLast7Days ? "Open Transactions to see why" : "None"}
            />
          </div>
          <Card
            title="Latest transactions"
            action={
              <Link href="/transactions" className="text-sm font-medium text-navy hover:underline">
                View all
              </Link>
            }
          >
            {data.latestTransactions.length ? (
              <TransactionRows rows={data.latestTransactions} />
            ) : (
              <Empty>No transactions yet.</Empty>
            )}
          </Card>
        </div>
      ) : null}
    </>
  );
}
