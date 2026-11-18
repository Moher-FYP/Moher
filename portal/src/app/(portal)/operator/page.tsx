"use client";

import { useState } from "react";
import { FreezeTable } from "@/components/FreezeTable";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Loading,
  PageHeader,
  Table,
  Td,
  useLoad,
} from "@/components/ui";
import { api, type FreezeRequest, type PartnerRow } from "@/lib/api";
import { short } from "@/lib/format";

/** MOHAR's own view: every partner, and freeze requests waiting for a decision. */
export default function OperatorPage() {
  const partners = useLoad(() =>
    api<{ data: PartnerRow[]; complianceKey: string | null }>("/admin/partners"),
  );
  const freezes = useLoad(() => api<{ data: FreezeRequest[] }>("/freeze-requests"));
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();

  async function decide(request: FreezeRequest, decision: "approve" | "reject") {
    const verb = decision === "approve" ? request.action : "reject this request";
    if (
      !window.confirm(
        `${verb[0]!.toUpperCase()}${verb.slice(1)} wallet ${request.walletId} of ${request.partnerSlug}?`,
      )
    )
      return;
    setBusy(request.id);
    setError(undefined);
    try {
      await api(`/admin/freeze-requests/${request.id}/${decision}`, { method: "POST", body: {} });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
      freezes.reload();
    }
  }

  const key = partners.data?.complianceKey;
  return (
    <>
      <PageHeader title="Partners and freezes" subtitle="MOHAR operators only." />
      <div className="space-y-6">
        <Card
          title="Freeze requests"
          action={
            partners.data ? (
              <Badge tone={key ? "ok" : "warn"}>
                {key
                  ? `Compliance key ${short(key)}`
                  : "No compliance key: approvals cannot be sent"}
              </Badge>
            ) : null
          }
        >
          <p className="mb-4 text-sm text-ink-soft">
            A partner&apos;s compliance team asks; you decide. Approving sends the freeze from
            MOHAR&apos;s compliance key, which can freeze and unfreeze and nothing else. The reason
            stays here; the chain records only a hash of the request.
          </p>
          <ErrorBox error={error ?? freezes.error} />
          {freezes.loading ? <Loading /> : null}
          {freezes.data && freezes.data.data.length === 0 ? <Empty>No requests.</Empty> : null}
          {freezes.data?.data.length ? (
            <FreezeTable
              rows={freezes.data.data}
              showPartner
              actions={(r) =>
                r.status === "pending" ? (
                  <div className="flex gap-2">
                    <Button
                      variant="danger"
                      disabled={busy === r.id}
                      onClick={() => void decide(r, "approve")}
                    >
                      {busy === r.id ? "Sending…" : r.action === "freeze" ? "Freeze" : "Unfreeze"}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy === r.id}
                      onClick={() => void decide(r, "reject")}
                    >
                      Reject
                    </Button>
                  </div>
                ) : null
              }
            />
          ) : null}
        </Card>
        <Card title="Partners">
          <ErrorBox error={partners.error} />
          {partners.loading ? <Loading /> : null}
          {partners.data ? (
            <Table head={["Partner", "On-chain id", "Registered on-chain", "Customers", "Webhook"]}>
              {partners.data.data.map((p) => (
                <tr key={p.slug}>
                  <Td className="font-medium">{p.slug}</Td>
                  <Td className="mono text-ink-soft">{short(p.partnerId, 10, 6)}</Td>
                  <Td>
                    <Badge tone={p.activeOnChain ? "ok" : "bad"}>
                      {p.activeOnChain ? "active" : "not registered"}
                    </Badge>
                  </Td>
                  <Td>{p.customers}</Td>
                  <Td className="mono text-ink-soft">{p.webhookUrl ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          ) : null}
        </Card>
      </div>
    </>
  );
}
