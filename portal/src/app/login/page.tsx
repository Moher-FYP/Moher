"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button, ErrorBox, Field, inputClass } from "@/components/ui";
import { api, ApiError, type Me } from "@/lib/api";
import { Wordmark } from "@/components/Brand";

function SignIn() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      const me = await api<Me>("/session", {
        method: "POST",
        body: {
          email: String(form.get("email")),
          password: String(form.get("password")),
          code: String(form.get("code")).replace(/\s/g, ""),
        },
      });
      // Only a path on this site, never a full URL from the query string (open redirect).
      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;
      router.replace(safeNext ?? (me.user.role === "operator" ? "/operator" : "/"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        const wait = Number(e.details?.retryAfterSeconds ?? 0);
        setError(new Error(`Too many attempts. Try again in ${wait} seconds.`));
      } else {
        setError(e);
      }
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <Wordmark size={28} />
        </div>
        <form
          onSubmit={(e) => void submit(e)}
          className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-6"
        >
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-ink">
            Sign in
          </h1>
          <Field label="Work email">
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              className={inputClass}
            />
          </Field>
          <Field label="Password">
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              className={inputClass}
            />
          </Field>
          <Field label="Code from your authenticator app" hint="Six digits. Each code works once.">
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\s*\d{3}\s*\d{3}\s*"
              required
              className={`${inputClass} tracking-[0.3em]`}
            />
          </Field>
          <ErrorBox error={error} />
          <Button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="mt-4 text-xs text-ink-faint">
          For partner staff. Accounts are created by MOHAR. After 5 wrong attempts each try waits
          longer; after 20 the account is locked until MOHAR re-enables it.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
