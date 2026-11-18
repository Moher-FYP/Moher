"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { useMe } from "@/components/Shell";
import { DeliveryRows } from "@/components/DeliveryRows";
import {
  ButtonLink,
  Card,
  Empty,
  ErrorBox,
  Loading,
  PageHeader,
  StatusBadge,
  useLoad,
} from "@/components/ui";
import { api, type Delivery, type Page, type TransactionDetail } from "@/lib/api";
import { grams, rupees, TYPE_NAMES, when } from "@/lib/format";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-4 py-2 text-sm">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="col-span-2 text-ink">{children}</dd>
    </div>
  );
}

function Step({
  done,
  bad,
  title,
  children,
}: {
  done: boolean;
  bad?: boolean;
  title: string;
  children?: ReactNode;
}) {
  return (
    <li className="relative pl-7">
      <span
        aria-hidden
        className={`absolute left-0 top-1 h-3.5 w-3.5 rounded-full border-2 ${
          bad ? "border-bad bg-bad" : done ? "border-ok bg-ok" : "border-line bg-surface"
        }`}
      />
      <p className="text-sm font-medium text-ink">{title}</p>
      {children ? <div className="text-sm text-ink-soft">{children}</div> : null}
    </li>
  );
}

/** "What happened to this trade?" in one place: from the quote to the webhook. */
export default function TransactionPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const { data, error, loading } = useLoad(
    () => api<TransactionDetail>(`/transactions/${id}`),
    [id],
  );
  const developer = me.user.role === "developer";
  const deliveries = useLoad(
    () =>
      developer
        ? api<Page<Delivery>>(`/webhook/deliveries?transactionId=${id}`)
        : Promise.resolve(undefined),
    [id, developer],
  );
  const t = data?.transaction;
  const q = data?.quote;

  return (
    <>
      <PageHeader
        title={t ? `${TYPE_NAMES[t.type]} · ${grams(t.grams)}` : "Transaction"}
        subtitle={<span className="mono">{id}</span>}
        actions={
          <>
            {t ? <StatusBadge status={t.status} /> : null}
            {t?.explorerUrl ? <ButtonLink href={t.explorerUrl}>Polygonscan</ButtonLink> : null}
          </>
        }
      />
      <ErrorBox error={error} />
      {loading ? <Loading /> : null}
      {t ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <Card title="What happened" className="lg:col-span-2">
            <ol className="space-y-5 border-l border-line pl-0">
              {q ? (
                <Step done title="Quote given">
                  {when(q.createdAt)} · price locked until {when(q.expiresAt)}
                </Step>
              ) : null}
              <Step done title="Trade accepted">
                {when(t.createdAt)}
              </Step>
              <Step done={Boolean(t.txHash)} title="Sent to Polygon">
                {t.txHash ? <span className="mono">{t.txHash}</span> : "Not sent"}
              </Step>
              {t.status === "failed" ? (
                <Step done bad title="Failed, nothing moved">
                  {data?.failureMessage ?? t.failureCode}
                </Step>
              ) : (
                <Step done={t.status === "confirmed"} title="Settled on-chain">
                  {t.confirmedAt ? `${when(t.confirmedAt)} · block ${t.blockNumber}` : "Waiting"}
                </Step>
              )}
            </ol>
          </Card>
          <Card title="Details" className="lg:col-span-3">
            <dl className="divide-y divide-line">
              <Row label="Customer wallet">
                <Link href={`/customers/${t.walletId}`} className="mono text-navy hover:underline">
                  {t.walletId}
                </Link>
              </Row>
              {t.counterpartyWalletId ? (
                <Row label="Sent to">
                  <Link
                    href={`/customers/${t.counterpartyWalletId}`}
                    className="mono text-navy hover:underline"
                  >
                    {t.counterpartyWalletId}
                  </Link>
                </Row>
              ) : null}
              <Row label="Gold">
                <span className="mono">{t.grams} g</span>
              </Row>
              {q ? (
                <>
                  <Row label={q.side === "buy" ? "Customer paid" : "Customer received"}>
                    {rupees(q.netAmountPkr)}
                  </Row>
                  <Row label="Gold value">{rupees(q.grossAmountPkr)}</Row>
                  <Row label="Fees">
                    MOHAR fee {rupees(q.fees.platformFeePkr)} · FX margin{" "}
                    {rupees(q.fees.fxMarginPkr)}
                  </Row>
                  <Row label="Price">
                    {rupees(q.price.pricePerGramPkr)} a gram · ${q.price.xauUsd}/oz · Rs{" "}
                    {q.price.usdPkr}/$ · {q.price.source}
                  </Row>
                </>
              ) : null}
              {t.failureCode ? <Row label="Failure code">{t.failureCode}</Row> : null}
            </dl>
          </Card>
          {developer ? (
            <Card title="Webhooks sent for this transaction" className="lg:col-span-5">
              <ErrorBox error={deliveries.error} />
              {deliveries.data?.data.length ? (
                <DeliveryRows rows={deliveries.data.data} onResent={deliveries.reload} />
              ) : (
                <Empty>No webhooks recorded for this transaction.</Empty>
              )}
            </Card>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
