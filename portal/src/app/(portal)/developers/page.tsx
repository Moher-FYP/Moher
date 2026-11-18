"use client";

import { useState, type FormEvent } from "react";
import { DeliveryRows } from "@/components/DeliveryRows";
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  inputClass,
  Loading,
  PageHeader,
  SecretOnce,
  StatusBadge,
  Table,
  Td,
  useLoad,
} from "@/components/ui";
import { api, type ApiKey, type Delivery, type Page, type WebhookSettings } from "@/lib/api";
import { when } from "@/lib/format";

function ApiKeys() {
  const keys = useLoad(() =>
    api<{ data: ApiKey[]; configured: { prefix: string }[] }>("/api-keys"),
  );
  const [shown, setShown] = useState<string>();
  const [error, setError] = useState<unknown>();

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name"));
    setError(undefined);
    try {
      const made = await api<{ key: string }>("/api-keys", { method: "POST", body: { name } });
      setShown(made.key);
      form.reset();
      keys.reload();
    } catch (e) {
      setError(e);
    }
  }

  async function revoke(key: ApiKey) {
    if (
      !window.confirm(
        `Revoke "${key.name}" (${key.prefix}…)? Requests using it are refused at once.`,
      )
    )
      return;
    try {
      await api(`/api-keys/${key.id}/revoke`, { method: "POST" });
      keys.reload();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Card title="API keys">
      <p className="mb-4 text-sm text-ink-soft">
        Your servers call MOHAR with these. Keep them on the server only, never in an app or a
        browser. To rotate: create a new key, move your servers to it, then revoke the old one.
      </p>
      {shown ? (
        <div className="mb-4">
          <SecretOnce label="New API key" value={shown} onDone={() => setShown(undefined)} />
        </div>
      ) : null}
      <ErrorBox error={error ?? keys.error} />
      {keys.loading ? <Loading /> : null}
      {keys.data ? (
        <Table head={["Name", "Starts with", "Created", "Last used", "Status", ""]}>
          {keys.data.data.map((k) => (
            <tr key={k.id}>
              <Td className="font-medium">{k.name}</Td>
              <Td className="mono">{k.prefix}…</Td>
              <Td className="text-ink-soft">{when(k.createdAt)}</Td>
              <Td className="text-ink-soft">{when(k.lastUsedAt)}</Td>
              <Td>
                <StatusBadge status={k.status} />
              </Td>
              <Td>
                {k.status === "active" ? (
                  <button
                    onClick={() => void revoke(k)}
                    className="text-sm font-medium text-bad hover:underline"
                  >
                    Revoke
                  </button>
                ) : null}
              </Td>
            </tr>
          ))}
          {keys.data.configured.map((c) => (
            <tr key={c.prefix}>
              <Td className="font-medium">Set up by MOHAR</Td>
              <Td className="mono">{c.prefix}…</Td>
              <Td className="text-ink-soft">—</Td>
              <Td className="text-ink-soft">—</Td>
              <Td>
                <Badge>configured</Badge>
              </Td>
              <Td className="text-xs text-ink-faint">Ask MOHAR to change</Td>
            </tr>
          ))}
        </Table>
      ) : null}
      <form onSubmit={(e) => void create(e)} className="mt-5 flex items-end gap-3">
        <div className="w-72">
          <Field label="New key name">
            <input
              name="name"
              required
              maxLength={64}
              placeholder="e.g. Production server"
              className={inputClass}
            />
          </Field>
        </div>
        <Button type="submit">Create key</Button>
      </form>
    </Card>
  );
}

function Webhook() {
  const settings = useLoad(() => api<WebhookSettings>("/webhook"));
  const [secret, setSecret] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = String(new FormData(event.currentTarget).get("url"));
    setError(undefined);
    setSaved(false);
    try {
      await api("/webhook", { method: "PUT", body: { url } });
      setSaved(true);
      settings.reload();
    } catch (e) {
      setError(e);
    }
  }

  async function rotate() {
    if (
      !window.confirm("Replace the signing secret? Events are signed with the new one from now on.")
    )
      return;
    try {
      setSecret(
        (await api<{ secret: string }>("/webhook/rotate-secret", { method: "POST" })).secret,
      );
      settings.reload();
    } catch (e) {
      setError(e);
    }
  }

  const s = settings.data;
  return (
    <Card title="Webhook">
      <p className="mb-4 text-sm text-ink-soft">
        MOHAR posts <span className="mono">transaction.confirmed</span> and{" "}
        <span className="mono">transaction.failed</span> here, signed in the{" "}
        <span className="mono">Mohar-Signature</span> header. Check it with the SDK&apos;s{" "}
        <span className="mono">verifyWebhookSignature</span>.
      </p>
      {secret ? (
        <div className="mb-4">
          <SecretOnce
            label="New webhook signing secret"
            value={secret}
            onDone={() => setSecret(undefined)}
          />
        </div>
      ) : null}
      <ErrorBox error={error ?? settings.error} />
      {s ? (
        <form key={s.url ?? "none"} onSubmit={(e) => void save(e)} className="space-y-4">
          <Field
            label="URL"
            hint={
              s.localhostAllowed
                ? "https, or http://localhost for the local demo. Internal addresses are refused."
                : "https, on a public address. Internal and private addresses are refused."
            }
          >
            <input
              name="url"
              required
              defaultValue={s.url}
              maxLength={2048}
              className={`${inputClass} mono`}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit">Save URL</Button>
            <Button variant="secondary" onClick={() => void rotate()}>
              Replace signing secret
            </Button>
            {saved ? <span className="text-sm text-ok">Saved</span> : null}
            <span className="text-xs text-ink-faint">
              {s.secretSet
                ? `Secret set${s.secretSetAt ? ` ${when(s.secretSetAt)}` : ""}`
                : "No secret of your own yet"}
            </span>
          </div>
        </form>
      ) : settings.loading ? (
        <Loading />
      ) : null}
    </Card>
  );
}

function Deliveries() {
  const deliveries = useLoad(() => api<Page<Delivery>>("/webhook/deliveries?limit=50"));
  return (
    <Card
      title="Deliveries"
      action={
        <button
          onClick={deliveries.reload}
          className="text-sm font-medium text-navy hover:underline"
        >
          Refresh
        </button>
      }
    >
      <ErrorBox error={deliveries.error} />
      {deliveries.loading ? <Loading /> : null}
      {deliveries.data && deliveries.data.data.length === 0 ? (
        <Empty>No webhooks sent yet.</Empty>
      ) : null}
      {deliveries.data?.data.length ? (
        <DeliveryRows rows={deliveries.data.data} onResent={deliveries.reload} />
      ) : null}
    </Card>
  );
}

export default function DevelopersPage() {
  return (
    <>
      <PageHeader
        title="API keys and webhooks"
        subtitle="Everything your engineers need to connect to MOHAR."
      />
      <div className="space-y-6">
        <ApiKeys />
        <Webhook />
        <Deliveries />
      </div>
    </>
  );
}
