"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useMe } from "@/components/Shell";
import { TransactionRows } from "@/components/TransactionRows";
import { Card, Empty, ErrorBox, inputClass, Loading, PageHeader, useLoad } from "@/components/ui";
import { api, type Page, type Transaction } from "@/lib/api";

const TYPES = ["mint", "burn", "transfer"];
const STATUSES = ["confirmed", "failed", "pending", "submitted"];

export default function TransactionsPage() {
  // Filters live in the address (?type=&status=) so the analytics pages can link here.
  return (
    <Suspense fallback={<Loading />}>
      <TransactionsBody />
    </Suspense>
  );
}

function TransactionsBody() {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const pick = (value: string | null, allowed: string[]) =>
    value && allowed.includes(value) ? value : "";
  const type = pick(params.get("type"), TYPES);
  const status = pick(params.get("status"), STATUSES);
  const setFilter = (name: "type" | "status", value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const [cursor, setCursor] = useState<string | undefined>();
  const filters = new URLSearchParams({ ...(type ? { type } : {}), ...(status ? { status } : {}) });
  const page = new URLSearchParams(filters);
  page.set("limit", "25");
  if (cursor) page.set("cursor", cursor);
  const { data, error, loading } = useLoad(
    () => api<Page<Transaction>>(`/transactions?${page}`),
    [type, status, cursor],
  );

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle="Every buy, sell and transfer your customers made, newest first."
        actions={
          me.user.role === "compliance" ? (
            // A plain link: the browser downloads the CSV with the session cookie.
            <a
              href={`/portal/v1/transactions.csv?${filters}`}
              className="rounded-[var(--radius-control)] border border-line bg-surface px-3.5 py-2 text-sm font-medium text-ink hover:bg-sunken"
            >
              Export CSV
            </a>
          ) : null
        }
      />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <select
            aria-label="Type"
            value={type}
            onChange={(e) => {
              setFilter("type", e.target.value);
              setCursor(undefined);
            }}
            className={`${inputClass.replace("w-full", "")} w-44`}
          >
            <option value="">All types</option>
            <option value="mint">Buy</option>
            <option value="burn">Sell</option>
            <option value="transfer">Transfer</option>
          </select>
          <select
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setFilter("status", e.target.value);
              setCursor(undefined);
            }}
            className={`${inputClass.replace("w-full", "")} w-44`}
          >
            <option value="">All statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
            <option value="submitted">Submitted</option>
          </select>
        </div>
        <ErrorBox error={error} />
        {loading ? <Loading /> : null}
        {data && data.data.length === 0 ? <Empty>No transactions match.</Empty> : null}
        {data && data.data.length > 0 ? <TransactionRows rows={data.data} /> : null}
        {data?.nextCursor ? (
          <button
            onClick={() => setCursor(data.nextCursor)}
            className="mt-4 text-sm font-medium text-navy hover:underline"
          >
            Next page
          </button>
        ) : null}
      </Card>
    </>
  );
}
