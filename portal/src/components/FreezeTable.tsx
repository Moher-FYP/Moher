"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { StatusBadge, Table, Td } from "@/components/ui";
import type { FreezeRequest } from "@/lib/api";
import { short, when } from "@/lib/format";

export function FreezeTable({
  rows,
  showPartner,
  actions,
}: {
  rows: FreezeRequest[];
  showPartner?: boolean;
  actions?: (r: FreezeRequest) => ReactNode;
}) {
  return (
    <Table
      head={[
        "Asked",
        ...(showPartner ? ["Partner"] : []),
        "Wallet",
        "Action",
        "Reason",
        "Status",
        ...(actions ? [""] : []),
      ]}
    >
      {rows.map((r) => (
        <tr key={r.id}>
          <Td className="whitespace-nowrap text-ink-soft">{when(r.requestedAt)}</Td>
          {showPartner ? <Td>{r.partnerSlug}</Td> : null}
          <Td>
            {showPartner ? (
              <span className="mono">{short(r.walletId, 8, 4)}</span>
            ) : (
              <Link href={`/customers/${r.walletId}`} className="mono text-navy hover:underline">
                {short(r.walletId, 8, 4)}
              </Link>
            )}
          </Td>
          <Td>{r.action}</Td>
          <Td className="max-w-xs text-ink-soft">{r.reason}</Td>
          <Td>
            <StatusBadge status={r.status} />
            {r.txHash ? <p className="mono mt-1 text-ink-faint">{short(r.txHash, 10, 6)}</p> : null}
            {r.failure ? <p className="mt-1 text-xs text-bad">{r.failure}</p> : null}
          </Td>
          {actions ? <Td>{actions(r)}</Td> : null}
        </tr>
      ))}
    </Table>
  );
}
