import Link from "next/link";
import { signOut } from "@/app/actions";
import type { Customer } from "@/lib/customers";

/** Bank chrome: a back link or the bank name, plus who is signed in. */
export function AppHeader({
  customer,
  title,
  backHref,
}: {
  customer: Customer;
  title?: string;
  backHref?: string;
}) {
  return (
    <header className="flex items-center justify-between gap-3 bg-bank px-5 py-4 text-white">
      <div className="flex min-w-0 items-center gap-3">
        {backHref ? (
          <Link
            href={backHref}
            className="-ml-1 rounded-full px-2 py-1 text-lg leading-none hover:bg-white/10"
            aria-label="Back"
          >
            ‹
          </Link>
        ) : (
          <span
            aria-hidden="true"
            className="grid size-8 place-items-center rounded-lg bg-white font-display text-sm font-bold text-bank"
          >
            DB
          </span>
        )}
        <span className="truncate font-display text-lg font-semibold">{title ?? "Demo Bank"}</span>
      </div>
      <form action={signOut} className="flex items-center gap-2 text-sm text-white/80">
        <span className="hidden sm:inline">{customer.firstName}</span>
        <button type="submit" className="rounded-full px-2 py-1 underline-offset-2 hover:underline">
          Sign out
        </button>
      </form>
    </header>
  );
}
