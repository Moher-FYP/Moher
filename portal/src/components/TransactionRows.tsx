"use client";

import Link from "next/link";
import { StatusBadge, Table, Td } from "@/components/ui";
import type { Transaction } from "@/lib/api";
import { grams, rupees, short, TYPE_NAMES, when } from "@/lib/format";

export function TransactionRows({ rows }: { rows: Transaction[] }) {
  return (
    <Table head={["When", "Type", "Customer wallet", "Gold", "Amount", "Status"]}>
      {rows.map((t) => (
        <tr key={t.id} className="hover:bg-sunken">
          <Td className="whitespace-nowrap text-ink-soft">{when(t.createdAt)}</Td>
          <Td>
            <Link href={`/transactions/${t.id}`} className="font-medium text-navy hover:underline">
              {TYPE_NAMES[t.type]}
            </Link>
          </Td>
          <Td>
            <Link href={`/customers/${t.walletId}`} className="mono text-ink-soft hover:underline">
              {short(t.walletId, 8, 4)}
            </Link>
          </Td>
          <Td className="whitespace-nowrap">
            <span title={t.grams}>{grams(t.grams)}</span>
          </Td>
          <Td className="whitespace-nowrap">{rupees(t.netAmountPkr)}</Td>
          <Td>
            <StatusBadge status={t.status} />
          </Td>
        </tr>
      ))}
    </Table>
  );
}
