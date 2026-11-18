"use client";

import { useState } from "react";
import { FreezeTable } from "@/components/FreezeTable";
import { useMe } from "@/components/Shell";
import {
  Badge,
  Card,
  Empty,
  ErrorBox,
  Loading,
  PageHeader,
  Table,
  Td,
  useLoad,
} from "@/components/ui";
import { api, type AuditEntry, type ChainCheck, type FreezeRequest } from "@/lib/api";
import { short, when } from "@/lib/format";

function ChainBadge({ name, check }: { name: string; check: ChainCheck }) {
  return (
    <Badge tone={check.intact ? "ok" : "bad"}>
      {name}:{" "}
      {check.intact
        ? `intact, ${check.entries} ${check.entries === 1 ? "entry" : "entries"}`
        : `broken at entry ${check.firstBrokenSeq}`}
    </Badge>
  );
}

function Log() {
  const [log, setLog] = useState<"audit" | "security">("audit");
  const [cursor, setCursor] = useState<string>();
  const page = useLoad(
    () =>
      api<{ data: AuditEntry[]; nextCursor?: string }>(
        `/audit?log=${log}&limit=50${cursor ? `&cursor=${cursor}` : ""}`,
      ),
    [log, cursor],
  );
  const tab = (name: "audit" | "security", label: string) => (
    <button
      onClick={() => {
        setLog(name);
        setCursor(undefined);
      }}
      className={`rounded-[var(--radius-control)] px-3 py-1.5 text-sm ${log === name ? "bg-sunken font-semibold text-navy" : "text-ink-soft"}`}
    >
      {label}
    </button>
  );
  return (
    <Card
      title="Logs"
      action={
        <div className="flex gap-1">
          {tab("audit", "Changes")}
          {tab("security", "Sign-ins and refusals")}
        </div>
      }
    >
      <ErrorBox error={page.error} />
      {page.loading ? <Loading /> : null}
      {page.data && page.data.data.length === 0 ? <Empty>Nothing logged yet.</Empty> : null}
      {page.data?.data.length ? (
        <Table head={["#", "When", "Who", "What", "Target", "Result", "From"]}>
          {page.data.data.map((e) => (
            <tr key={e.seq}>
              <Td className="text-ink-faint">{e.seq}</Td>
              <Td className="whitespace-nowrap text-ink-soft">{when(e.at)}</Td>
              <Td>{e.email ?? "—"}</Td>
              <Td>
                <span className="mono">{e.action}</span>
                {e.detail ? (
                  <p className="mono mt-0.5 text-ink-faint" title={JSON.stringify(e.detail)}>
                    {short(JSON.stringify(e.detail), 60, 0)}
                  </p>
                ) : null}
              </Td>
              <Td className="mono text-ink-soft">{e.target ? short(e.target, 12, 4) : "—"}</Td>
              <Td>
                <Badge tone={e.result === "ok" ? "ok" : e.result === "refused" ? "warn" : "bad"}>
                  {e.result}
                </Badge>
              </Td>
              <Td className="mono text-ink-faint">{e.ip ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      ) : null}
      {page.data?.nextCursor ? (
        <button
          onClick={() => setCursor(page.data?.nextCursor)}
          className="mt-4 text-sm font-medium text-navy hover:underline"
        >
          Older entries
        </button>
      ) : null}
    </Card>
  );
}

export default function CompliancePage() {
  const me = useMe();
  const verify = useLoad(() => api<{ audit: ChainCheck; security: ChainCheck }>("/audit/verify"));
  const freezes = useLoad(() => api<{ data: FreezeRequest[] }>("/freeze-requests"));
  const operator = me.user.role === "operator";

  return (
    <>
      <PageHeader
        title={operator ? "Audit log" : "Compliance"}
        subtitle="Every change made in the portal and every sign-in. Each entry carries the hash of the one before it, so an edited or deleted entry shows up below."
        actions={
          verify.data ? (
            <>
              <ChainBadge name="Changes" check={verify.data.audit} />
              <ChainBadge name="Sign-ins" check={verify.data.security} />
            </>
          ) : null
        }
      />
      <div className="space-y-6">
        {!operator ? (
          <Card title="Freeze requests">
            <ErrorBox error={freezes.error} />
            {freezes.data?.data.length ? (
              <FreezeTable rows={freezes.data.data} />
            ) : (
              <Empty>None yet. Ask for a freeze from a customer&apos;s page.</Empty>
            )}
          </Card>
        ) : null}
        <Log />
      </div>
    </>
  );
}
