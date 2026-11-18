"use client";

import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMe } from "@/components/Shell";
import { TransactionRows } from "@/components/TransactionRows";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Empty,
  ErrorBox,
  Field,
  inputClass,
  Loading,
  PageHeader,
  Stat,
  StatusBadge,
  useLoad,
} from "@/components/ui";
import {
  api,
  type FreezeRequest,
  type LimitUse,
  type Page,
  type Transaction,
  type WalletDetail,
} from "@/lib/api";
import { grams, KYC_NAMES, percent, rupees } from "@/lib/format";

function LimitBar({ label, use }: { label: string; use: LimitUse }) {
  const share = percent(use.usedPkr, use.limitPkr);
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-ink-soft">{label}</span>
        <span className="text-ink">
          {rupees(use.usedPkr)} <span className="text-ink-faint">of {rupees(use.limitPkr)}</span>
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-sunken">
        <div
          className={`h-full rounded-full ${share >= 90 ? "bg-bad" : share >= 70 ? "bg-warn" : "bg-navy"}`}
          style={{ width: `${share}%` }}
        />
      </div>
    </div>
  );
}

function FreezeForm({ wallet, onDone }: { wallet: WalletDetail; onDone: () => void }) {
  const [error, setError] = useState<unknown>();
  const [sent, setSent] = useState<FreezeRequest>();
  const action = wallet.status === "frozen" ? "unfreeze" : "freeze";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason"));
    try {
      setSent(
        await api<FreezeRequest>(`/wallets/${wallet.id}/freeze-requests`, {
          method: "POST",
          body: { action, reason },
        }),
      );
      onDone();
    } catch (e) {
      setError(e);
    }
  }

  if (sent) {
    return (
      <p className="text-sm text-ink-soft">
        Request <span className="mono">{sent.id}</span> sent. A MOHAR operator will review it; the
        decision appears under Compliance.
      </p>
    );
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <Field
        label={`Reason to ${action} this wallet`}
        hint="At least 10 characters. Kept by MOHAR; never written to the blockchain."
      >
        <textarea
          name="reason"
          required
          minLength={10}
          maxLength={500}
          rows={3}
          className={inputClass}
        />
      </Field>
      <ErrorBox error={error} />
      <Button type="submit" variant={action === "freeze" ? "danger" : "primary"}>
        Ask MOHAR to {action}
      </Button>
    </form>
  );
}

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const wallet = useLoad(() => api<WalletDetail>(`/wallets/${id}`), [id]);
  const txns = useLoad(() => api<Page<Transaction>>(`/transactions?walletId=${id}&limit=50`), [id]);
  const w = wallet.data;

  return (
    <>
      <PageHeader
        title={w ? w.externalCustomerId : "Customer"}
        subtitle={<span className="mono">{id}</span>}
        actions={
          <>
            {w ? <StatusBadge status={w.status} /> : null}
            {w?.explorerUrl ? <ButtonLink href={w.explorerUrl}>Polygonscan</ButtonLink> : null}
          </>
        }
      />
      <ErrorBox error={wallet.error} />
      {wallet.loading ? <Loading /> : null}
      {w ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat
              label="Gold"
              value={<span title={w.balanceGrams}>{grams(w.balanceGrams)}</span>}
            />
            <Stat label="Value today" value={rupees(w.valuePkr)} />
            <Stat
              label="KYC level"
              value={KYC_NAMES[w.kycLevel]}
              note={`Up to ${rupees(w.limits.perTradePkr)} a trade`}
            />
          </div>
          <Card title="KYC limits used" action={<Badge>Money in: buys and gold received</Badge>}>
            <div className="space-y-4">
              <LimitBar label="Last 24 hours" use={w.limits.last24Hours} />
              <LimitBar label="Last 30 days" use={w.limits.last30Days} />
              <LimitBar label="Gold held, at today's price" use={w.limits.holding} />
            </div>
          </Card>
          <Card title="Transactions">
            <ErrorBox error={txns.error} />
            {txns.data?.data.length ? (
              <TransactionRows rows={txns.data.data} />
            ) : (
              <Empty>None yet.</Empty>
            )}
          </Card>
          {me.user.role === "compliance" ? (
            <Card title={w.status === "frozen" ? "Unfreeze" : "Freeze"}>
              <FreezeForm wallet={w} onDone={wallet.reload} />
            </Card>
          ) : null}
          <p className="mono text-ink-faint">Custodial address {w.address}</p>
        </div>
      ) : null}
    </>
  );
}
