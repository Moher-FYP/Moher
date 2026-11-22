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
export function DevPanel({ partnerName }: { partnerName: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pending, startTransition] = useTransition();
  const [priceError, setPriceError] = useState<string>();
  const [price, setPrice] = useState<{ xauUsd: string }>();
  const [open, setOpen] = useState<number>();
  const router = useRouter();

  const loadPrice = async () => setPrice(await fetchPrice());

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      const latest = await fetchPrice();
      if (!stopped) setPrice(latest);
    };
    void tick();
    const timer = setInterval(tick, 10000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

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
        const refused = await moveGoldPrice(form);
        if (refused) setPriceError(refused);
        await loadPrice();
        router.refresh();
      } catch {
        setPriceError("Could not reach MOHAR to change the price.");
      }
    });
  };

  const usd = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <aside
      aria-labelledby="behind"
      className="min-w-0 flex-1 px-5 py-10 lg:px-0 lg:py-0 print:hidden"
    >
      <p className="inline-block rounded-full bg-sand px-3 py-1.5 text-[13px] font-bold">
        For evaluators · not part of the customer app
      </p>
      <h2
        id="behind"
        className="mt-3 font-display text-[38px] leading-none font-extrabold tracking-[-0.035em]"
      >
        Behind the scenes
      </h2>
      <p className="mt-3 max-w-[58ch] text-[17px] leading-normal text-ink-soft">
        The customer only sees {partnerName}. Underneath, its server calls the MOHAR API through the
        SDK, and MOHAR replies with signed webhooks. Each call appears here as it happens.
      </p>

      <section
        aria-labelledby="price-controls"
        className="ring-line mt-6 rounded-[26px] bg-surface px-[22px] py-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3
            id="price-controls"
            className="font-display text-xl font-extrabold tracking-[-0.02em]"
          >
            Price-band demo
          </h3>
          {price ? (
            <span className="rounded-full bg-sand px-3 py-1.5 text-[13px] font-bold">
              Gold US$ {usd.format(Number(price.xauUsd))} / oz
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 max-w-[60ch] text-[15px] leading-normal text-ink-soft">
          Get a price in the app, move gold by 1%, then confirm. The contract cancels any trade that
          moved more than 0.5%, and nothing is charged.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={pending}
            onClick={() => move("up")}
            className="h-11 rounded-full bg-ink px-[18px] text-[15px] font-bold text-white hover:bg-ink-soft disabled:opacity-50"
          >
            Gold up 1%
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => move("down")}
            className="ring-line-strong h-11 rounded-full bg-surface px-[18px] text-[15px] font-bold hover:bg-page disabled:opacity-50"
          >
            Gold down 1%
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => move("reset")}
            className="px-3 text-[15px] font-bold underline underline-offset-2 disabled:opacity-50"
          >
            Reset price
          </button>
        </div>
        {priceError ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {priceError}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="log" className="mt-7">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="log" className="font-display text-xl font-extrabold tracking-[-0.02em]">
            SDK calls and webhooks
          </h3>
          <p className="text-[13px] text-ink-soft">
            Newest first · open a call to see its request and response
          </p>
        </div>
        {entries.length === 0 ? (
          <p className="text-sm text-ink-soft">Nothing yet. Sign in to the app to start.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) =>
              entry.kind === "call" ? (
                <CallRow
                  key={entry.id}
                  call={entry}
                  open={open === entry.id}
                  onToggle={(isOpen) => setOpen(isOpen ? entry.id : undefined)}
                />
              ) : (
                <WebhookRow key={entry.id} hook={entry} partnerName={partnerName} />
              ),
            )}
          </ul>
        )}
      </section>
    </aside>
  );
}

async function fetchPrice(): Promise<{ xauUsd: string } | undefined> {
  try {
    const response = await fetch("/api/dev/price", { cache: "no-store" });
    return response.ok ? ((await response.json()) as { xauUsd: string }) : undefined;
  } catch {
    return undefined;
  }
}

function CallRow({
  call,
  open,
  onToggle,
}: {
  call: SdkCall;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  const ok = call.status !== null && call.status < 400;
  return (
    <li
      className={`overflow-hidden rounded-[14px] bg-surface text-sm ${open ? "border-[1.5px] border-ink" : "ring-line"}`}
    >
      {/* Controlled, so the open call stays open while the list refreshes every 1.5 s. */}
      <details open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-3 [&::-webkit-details-marker]:hidden">
          <span className="w-12 shrink-0 font-mono text-xs font-bold text-ink-soft">
            {call.method}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{call.path}</span>
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 font-mono text-xs font-bold ${
              ok ? "bg-ok-pale text-ok" : "bg-danger-pale text-danger"
            }`}
          >
            {call.status ?? "ERR"}
          </span>
          <span className="w-14 shrink-0 text-right font-mono text-xs text-ink-soft">
            {call.ms} ms
          </span>
        </summary>
        <div
          className={`grid gap-px border-t border-line bg-line ${call.request !== undefined ? "lg:grid-cols-2" : ""}`}
        >
          {call.request !== undefined ? <Json label="Request" value={call.request} /> : null}
          <Json label="Response" value={call.response} />
        </div>
      </details>
    </li>
  );
}

function WebhookRow({ hook, partnerName }: { hook: WebhookReceived; partnerName: string }) {
  return (
    <li
      className={`flex items-center gap-3 rounded-[14px] px-3.5 py-3 text-sm ${
        hook.verified ? "bg-hook" : "bg-danger-pale text-danger"
      }`}
    >
      <span className="w-12 shrink-0 font-mono text-xs font-bold">HOOK</span>
      <span className="min-w-0 flex-1 truncate">
        {hook.verified
          ? `MOHAR → ${partnerName}: ${hook.type} for ${hook.transactionId}`
          : `Rejected a webhook: ${hook.reason ?? "bad signature"}`}
      </span>
      {hook.verified ? (
        <span className="shrink-0 text-xs font-bold text-[#6b4a06]">signature verified</span>
      ) : null}
    </li>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0 bg-page px-3.5 py-3">
      <p className="mb-1.5 text-xs font-bold text-ink-soft">{label}</p>
      <pre className="max-h-72 overflow-auto font-mono text-xs leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
