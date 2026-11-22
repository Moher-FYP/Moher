"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";

/**
 * The portal's small set of building blocks. Every colour comes from theme.css through
 * Tailwind's theme names, so a new design system changes these without touching the pages.
 */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[28px] leading-tight font-extrabold tracking-[-0.03em] text-ink">
          {title}
        </h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-soft">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-[var(--radius-card)] border border-line bg-surface ${className}`}>
      {title ? (
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-display text-[15px] font-extrabold tracking-[-0.01em] text-ink">
            {title}
          </h2>
          {action}
        </div>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-2 font-display text-2xl font-extrabold tracking-[-0.02em] text-ink">
        {value}
      </p>
      {note ? <p className="mt-1 text-xs text-ink-soft">{note}</p> : null}
    </div>
  );
}

const TONES = {
  ok: "bg-ok-pale text-ok",
  warn: "bg-warn-pale text-warn",
  bad: "bg-bad-pale text-bad",
  plain: "bg-sunken text-ink-soft",
  gold: "bg-gold-pale text-ink",
} as const;

export function Badge({
  tone = "plain",
  children,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "confirmed" || status === "delivered" || status === "active" || status === "done"
      ? "ok"
      : status === "failed" || status === "frozen" || status === "revoked" || status === "rejected"
        ? "bad"
        : "warn";
  return <Badge tone={tone}>{status}</Badge>;
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  const styles = {
    primary: "bg-navy text-white hover:bg-navy-deep",
    secondary: "border border-line bg-surface text-ink hover:bg-sunken",
    danger: "bg-bad text-white hover:opacity-90",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

export function ButtonLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-sunken"
    >
      {children}
    </Link>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-xs text-ink-faint">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-navy focus:outline-none";

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-faint">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-top text-ink ${className}`}>{children}</td>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-ink-faint">{children}</p>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof ApiError || error instanceof Error ? error.message : String(error);
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-control)] bg-bad-pale px-4 py-3 text-sm text-bad"
    >
      {message}
    </div>
  );
}

/** Shown once: a new key or secret, with a copy button and a plain warning. */
export function SecretOnce({
  label,
  value,
  onDone,
}: {
  label: string;
  value: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-[var(--radius-card)] border border-gold bg-gold-pale p-4">
      <p className="text-sm font-semibold text-ink">{label}</p>
      <p className="mt-1 text-xs text-ink-soft">
        Shown once. Copy it into your password manager or your server&apos;s settings now; MOHAR
        cannot show it again.
      </p>
      <p className="mono mt-3 rounded-[var(--radius-control)] bg-surface px-3 py-2">{value}</p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button onClick={onDone}>I have saved it</Button>
      </div>
    </div>
  );
}

/**
 * Loads data for a page: { data, error, loading, reload }. Errors other than "signed out" are
 * shown on the page; signed-out sends the user to sign in (lib/api.ts).
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({
    loading: true,
  });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setState({ data, loading: false }),
      (error: unknown) => live && setState({ error, loading: false }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function Loading() {
  return <p className="py-8 text-center text-sm text-ink-faint">Loading…</p>;
}
