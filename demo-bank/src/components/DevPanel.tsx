"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { moveGoldPrice } from "@/app/actions";

interface SdkCall {
  kind: "call";
  id: number;
  at: string;
  method: string;
  path: string;
  status: number | null;
  ms: number;
  request?: unknown;
  response?: unknown;
}

interface WebhookReceived {
  kind: "webhook";
  id: number;
  at: string;
  type: string;
  verified: boolean;
  transactionId?: string;
  status?: string;
  reason?: string;
}

type Entry = SdkCall | WebhookReceived;

/**
 * The demo's second screen: what the bank's server sends to MOHAR through the SDK, and the
 * signed webhooks MOHAR sends back. Lets examiners see the B2B integration while the customer
 * app stays free of any MOHAR branding.
 */
export function DevPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pending, startTransition] = useTransition();
  const [priceError, setPriceError] = useState<string>();
  const router = useRouter();

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const response = await fetch("/api/dev/log", { cache: "no-store" });
        if (response.ok && !stopped) setEntries((await response.json()) as Entry[]);
      } catch {
        // dev server restarting
      }
    };
    void load();
    const timer = setInterval(load, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  const move = (direction: "up" | "down" | "reset") => {
    const form = new FormData();
    form.set("direction", direction);
    setPriceError(undefined);
    startTransition(async () => {
      try {
        await moveGoldPrice(form);
        router.refresh();
      } catch {
        setPriceError("Price control needs the local chain with the mock price feed.");
      }
    });
  };

  return (
    <aside aria-labelledby="behind" className="min-w-0 flex-1 space-y-5">
      <div>
        <h2 id="behind" className="font-display text-2xl font-semibold">
          Behind the scenes
        </h2>
        <p className="mt-1 max-w-prose text-ink-soft">
          The customer only ever sees Demo Bank. Underneath, the bank&apos;s server calls MOHAR
          through the SDK, and MOHAR answers with signed webhooks. Everything appears here as it
          happens.
        </p>
      </div>

      <section
        aria-labelledby="price-controls"
        className="rounded-2xl border border-line bg-surface p-4"
      >
        <h3 id="price-controls" className="font-semibold">
          Move the gold price
        </h3>
        <p className="mt-1 text-sm text-ink-soft">
          Get a price in the app, move the market by 1%, then confirm. MOHAR&apos;s contract cancels
          any trade that moved more than 0.5% — nothing is charged.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ["up", "Gold up 1%"],
              ["down", "Gold down 1%"],
              ["reset", "Reset to $4,616/oz"],
            ] as const
          ).map(([direction, label]) => (
            <button
              key={direction}
              type="button"
              disabled={pending}
              onClick={() => move(direction)}
              className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold hover:border-bank disabled:opacity-50"
            >
              {label}
            </button>
          ))}
        </div>
        {priceError ? <p className="mt-2 text-sm text-danger">{priceError}</p> : null}
      </section>

      <section aria-labelledby="log" className="space-y-2">
        <h3 id="log" className="font-semibold">
          SDK calls and webhooks, newest first
        </h3>
        {entries.length === 0 ? (
          <p className="text-sm text-ink-soft">Nothing yet. Sign in to the bank to start.</p>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) =>
              entry.kind === "call" ? (
                <CallRow key={entry.id} call={entry} />
              ) : (
                <WebhookRow key={entry.id} hook={entry} />
              ),
            )}
          </ul>
        )}
      </section>
    </aside>
  );
}

function CallRow({ call }: { call: SdkCall }) {
  const ok = call.status !== null && call.status < 400;
  return (
    <li className="rounded-xl border border-line bg-surface text-sm">
      <details>
        <summary className="flex cursor-pointer items-center gap-3 px-3 py-2">
          <span className="w-11 shrink-0 font-mono text-xs font-semibold text-ink-soft">
            {call.method}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{call.path}</span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-semibold ${
              ok ? "bg-bank/10 text-bank" : "bg-danger-pale text-danger"
            }`}
          >
            {call.status ?? "ERR"}
          </span>
          <span className="w-14 shrink-0 text-right font-mono text-xs text-ink-soft">
            {call.ms} ms
          </span>
        </summary>
        <div className="grid gap-2 border-t border-line p-3 lg:grid-cols-2">
          {call.request !== undefined ? <Json label="Request" value={call.request} /> : null}
          <Json label="Response" value={call.response} />
        </div>
      </details>
    </li>
  );
}

function WebhookRow({ hook }: { hook: WebhookReceived }) {
  return (
    <li
      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${
        hook.verified ? "bg-gold-pale/60" : "bg-danger-pale text-danger"
      }`}
    >
      <span className="w-11 shrink-0 font-mono text-xs font-semibold">HOOK</span>
      <span className="min-w-0 flex-1 truncate">
        {hook.verified
          ? `MOHAR → bank: ${hook.type} for ${hook.transactionId}`
          : `Rejected a webhook: ${hook.reason ?? "bad signature"}`}
      </span>
      {hook.verified ? (
        <span className="shrink-0 text-xs font-semibold text-gold-deep">signature verified</span>
      ) : null}
    </li>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-semibold text-ink-soft">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-lg bg-ink p-3 font-mono text-xs leading-relaxed text-[#d9e6df]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
