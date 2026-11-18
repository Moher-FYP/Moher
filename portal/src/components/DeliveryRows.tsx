"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorBox, StatusBadge, Table, Td } from "@/components/ui";
import { api, type Delivery } from "@/lib/api";
import { short, when } from "@/lib/format";

export function DeliveryRows({ rows, onResent }: { rows: Delivery[]; onResent: () => void }) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();

  async function resend(id: string) {
    setBusy(id);
    setError(undefined);
    try {
      await api(`/webhook/deliveries/${id}/resend`, { method: "POST" });
      onResent();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <>
      <ErrorBox error={error} />
      <Table head={["Sent", "Event", "Transaction", "Attempts", "Status", ""]}>
        {rows.map((d) => {
          const last = d.attempts.at(-1);
          return (
            <tr key={d.id}>
              <Td className="whitespace-nowrap text-ink-soft">{when(d.createdAt)}</Td>
              <Td>
                {d.event}
                {d.resendOf ? <span className="ml-1 text-xs text-ink-faint">(resend)</span> : null}
              </Td>
              <Td>
                <Link
                  href={`/transactions/${d.transactionId}`}
                  className="mono text-navy hover:underline"
                >
                  {short(d.transactionId, 8, 4)}
                </Link>
              </Td>
              <Td className="text-ink-soft">
                {d.attempts.length}
                {last
                  ? ` · last ${last.statusCode ? `HTTP ${last.statusCode}` : (last.error ?? "")} in ${last.ms} ms`
                  : ""}
              </Td>
              <Td>
                <StatusBadge status={d.status} />
              </Td>
              <Td>
                <button
                  onClick={() => void resend(d.id)}
                  disabled={busy === d.id}
                  className="text-sm font-medium text-navy hover:underline disabled:opacity-50"
                >
                  {busy === d.id ? "Sending…" : "Resend"}
                </button>
              </Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
