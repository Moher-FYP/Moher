"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Card,
  Empty,
  ErrorBox,
  inputClass,
  Loading,
  PageHeader,
  Table,
  Td,
  useLoad,
} from "@/components/ui";
import { api, type KycLevel, type Page, type Wallet } from "@/lib/api";
import { KYC_NAMES, short, when } from "@/lib/format";

export default function CustomersPage() {
  const [q, setQ] = useState("");
  const [kyc, setKyc] = useState<KycLevel | "">("");
  const [cursor, setCursor] = useState<string | undefined>();
  const query = new URLSearchParams({
    limit: "25",
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(kyc ? { kycLevel: kyc } : {}),
    ...(cursor ? { cursor } : {}),
  });
  const { data, error, loading } = useLoad(
    () => api<Page<Wallet>>(`/wallets?${query}`),
    [q, kyc, cursor],
  );

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Each customer's gold wallet. MOHAR holds no names, CNICs or phone numbers: only your own customer reference."
      />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(undefined);
            }}
            placeholder="Search by customer reference, wallet or address"
            className={`${inputClass} max-w-md`}
          />
          <select
            value={kyc}
            onChange={(e) => {
              setKyc(e.target.value as KycLevel | "");
              setCursor(undefined);
            }}
            className={`${inputClass} w-44`}
          >
            <option value="">All KYC levels</option>
            <option value="asaan">Asaan</option>
            <option value="standard">Standard</option>
            <option value="enhanced">Enhanced</option>
          </select>
        </div>
        <ErrorBox error={error} />
        {loading ? <Loading /> : null}
        {data && data.data.length === 0 ? <Empty>No customers match.</Empty> : null}
        {data && data.data.length > 0 ? (
          <>
            <Table head={["Customer reference", "Wallet", "Address", "KYC level", "Opened"]}>
              {data.data.map((w) => (
                <tr key={w.id} className="hover:bg-sunken">
                  <Td>
                    <Link
                      href={`/customers/${w.id}`}
                      className="font-medium text-navy hover:underline"
                    >
                      {w.externalCustomerId}
                    </Link>
                  </Td>
                  <Td className="mono text-ink-soft">{w.id}</Td>
                  <Td className="mono text-ink-soft">{short(w.address)}</Td>
                  <Td>{KYC_NAMES[w.kycLevel]}</Td>
                  <Td className="whitespace-nowrap text-ink-soft">{when(w.createdAt)}</Td>
                </tr>
              ))}
            </Table>
            {data.nextCursor ? (
              <button
                onClick={() => setCursor(data.nextCursor)}
                className="mt-4 text-sm font-medium text-navy hover:underline"
              >
                Next page
              </button>
            ) : null}
          </>
        ) : null}
      </Card>
    </>
  );
}
