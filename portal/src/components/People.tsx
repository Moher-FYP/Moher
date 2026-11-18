"use client";

import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";
import { useMe } from "@/components/Shell";
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  inputClass,
  Loading,
  StatusBadge,
  Table,
  Td,
  useLoad,
} from "@/components/ui";
import { api, type IssuedSecrets, type ManagedUser, type PartnerRow, type Role } from "@/lib/api";
import { when } from "@/lib/format";

/** A new user's sign-in details, shown once: QR code for the app, the password, the setup key. */
function IssuedOnce({ issued, onDone }: { issued: IssuedSecrets; onDone: () => void }) {
  const [qr, setQr] = useState<string>();
  useEffect(() => {
    void QRCode.toDataURL(issued.otpauthUri, {
      margin: 2,
      width: 200,
      errorCorrectionLevel: "M",
    }).then(setQr);
  }, [issued.otpauthUri]);

  return (
    <div className="rounded-[var(--radius-card)] border border-gold bg-gold-pale p-4">
      <p className="text-sm font-semibold text-ink">Sign-in details for {issued.user.email}</p>
      <p className="mt-1 text-xs text-ink-soft">
        Shown once. Give them to the person directly (in person or a password-manager share), never
        by chat or email. Anything signed in with the old details has been signed out.
      </p>
      <div className="mt-3 flex flex-wrap items-start gap-5">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt="QR code for the authenticator app"
            width={200}
            height={200}
            className="rounded bg-white"
          />
        ) : null}
        <div className="min-w-0 flex-1 space-y-3 text-sm">
          <p className="text-ink-soft">
            1. In the authenticator app: + → Other account (Microsoft) or Scan a QR code, and scan
            this.
          </p>
          <div>
            <p className="text-xs text-ink-faint">Password</p>
            <p className="mono rounded-[var(--radius-control)] bg-surface px-3 py-2">
              {issued.password}
            </p>
          </div>
          <div>
            <p className="text-xs text-ink-faint">Setup key (only if scanning fails)</p>
            <p className="mono rounded-[var(--radius-control)] bg-surface px-3 py-2">
              {issued.setupKey}
            </p>
          </div>
          <Button onClick={onDone}>Done, hide these</Button>
        </div>
      </div>
    </div>
  );
}

/** The operator's list of people: who can sign in, who is locked out, and the controls. */
export function People() {
  const me = useMe();
  const users = useLoad(() => api<{ data: ManagedUser[] }>("/admin/users"));
  const partners = useLoad(() => api<{ data: PartnerRow[] }>("/admin/partners"));
  const [issued, setIssued] = useState<IssuedSecrets>();
  const [error, setError] = useState<unknown>();
  const [role, setRole] = useState<Role>("developer");

  async function act(user: ManagedUser, action: "enable" | "disable" | "reset") {
    const ask = {
      enable: `Unlock ${user.email}?`,
      disable: `Lock ${user.email} and sign them out?`,
      reset: `Give ${user.email} a new password and authenticator key? Their current ones stop working now.`,
    }[action];
    if (!window.confirm(ask)) return;
    setError(undefined);
    try {
      const result = await api<IssuedSecrets | ManagedUser>(`/admin/users/${user.id}/${action}`, {
        method: "POST",
      });
      if (action === "reset") setIssued(result as IssuedSecrets);
      users.reload();
    } catch (e) {
      setError(e);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError(undefined);
    try {
      setIssued(
        await api<IssuedSecrets>("/admin/users", {
          method: "POST",
          body: {
            email: String(data.get("email")),
            role,
            ...(role === "operator" ? {} : { partner: String(data.get("partner")) }),
          },
        }),
      );
      form.reset();
      users.reload();
    } catch (e) {
      setError(e);
    }
  }

  const locked = users.data?.data.filter((u) => u.status === "disabled") ?? [];
  const struggling =
    users.data?.data.filter((u) => u.status === "active" && u.failedAttempts >= 5) ?? [];

  return (
    <Card
      title="People"
      action={
        locked.length || struggling.length ? (
          <Badge tone="bad">
            {locked.length} locked{struggling.length ? ` · ${struggling.length} slowed down` : ""}
          </Badge>
        ) : users.data ? (
          <Badge tone="ok">No locked accounts</Badge>
        ) : null
      }
    >
      {issued ? (
        <div className="mb-4">
          <IssuedOnce issued={issued} onDone={() => setIssued(undefined)} />
        </div>
      ) : null}
      <ErrorBox error={error ?? users.error} />
      {users.loading ? <Loading /> : null}
      {users.data ? (
        <Table head={["Email", "Role", "Partner", "Status", "Failed in a row", ""]}>
          {users.data.data.map((u) => (
            <tr key={u.id}>
              <Td className="font-medium">{u.email}</Td>
              <Td>{u.role}</Td>
              <Td>{u.partner ?? "MOHAR"}</Td>
              <Td>
                <StatusBadge status={u.status} />
              </Td>
              <Td className={u.failedAttempts >= 5 ? "text-bad" : "text-ink-soft"}>
                {u.failedAttempts}
                {u.lastFailedAt ? (
                  <span className="text-ink-faint"> · last {when(u.lastFailedAt)}</span>
                ) : null}
              </Td>
              <Td>
                {u.id === me.user.id ? (
                  <span className="text-xs text-ink-faint">You</span>
                ) : (
                  <div className="flex gap-3 text-sm font-medium">
                    {u.status === "disabled" ? (
                      <button
                        onClick={() => void act(u, "enable")}
                        className="text-navy hover:underline"
                      >
                        Unlock
                      </button>
                    ) : (
                      <button
                        onClick={() => void act(u, "disable")}
                        className="text-bad hover:underline"
                      >
                        Lock
                      </button>
                    )}
                    <button
                      onClick={() => void act(u, "reset")}
                      className="text-navy hover:underline"
                    >
                      Reset
                    </button>
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      ) : null}
      <form
        onSubmit={(e) => void add(e)}
        className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end"
      >
        <Field label="Email">
          <input name="email" type="email" required className={inputClass} />
        </Field>
        <Field label="Role">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className={inputClass}
          >
            <option value="viewer">Viewer</option>
            <option value="developer">Developer</option>
            <option value="compliance">Compliance</option>
            <option value="operator">MOHAR operator</option>
          </select>
        </Field>
        {role === "operator" ? (
          <p className="text-xs text-ink-faint">Operators are MOHAR staff and see every partner.</p>
        ) : (
          <Field label="Partner">
            <select name="partner" required className={inputClass}>
              {partners.data?.data.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.slug}
                </option>
              ))}
            </select>
          </Field>
        )}
        {/* Partner users need the partner list loaded first, or the form has nothing to pick. */}
        <Button type="submit" disabled={role !== "operator" && !partners.data?.data.length}>
          Add person
        </Button>
      </form>
    </Card>
  );
}
