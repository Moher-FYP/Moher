import Link from "next/link";
import { signIn } from "@/app/actions";
import { FormError, quietButton } from "@/components/ui";
import { allCustomers } from "@/lib/customers";
import { partner } from "@/lib/partner";

export default async function Login({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const p = partner();
  return (
    <>
      <header className="bg-bank px-6 pt-10 pb-8 text-white">
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-xl bg-white font-display font-bold text-bank"
        >
          {p.initials}
        </span>
        <h1 className="mt-6 font-display text-3xl font-semibold">{p.name}</h1>
        <p className="mt-2 text-white/80">{p.description}.</p>
        <p className="mt-3 inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-semibold">
          Demo partner · gold by MOHAR
        </p>
      </header>
      <div className="space-y-3 p-5">
        <FormError message={typeof error === "string" ? error : undefined} />
        <Link href="/signup" className={quietButton}>
          Open a new account
        </Link>
        <form action={signIn} className="space-y-3 pt-2">
          <p className="text-sm font-semibold text-ink-soft">Or sign in as a demo customer</p>
          {allCustomers().map((customer) => (
            <button
              key={customer.id}
              type="submit"
              name="customer"
              value={customer.id}
              className="flex w-full items-center gap-4 rounded-2xl border border-line p-4 text-left hover:border-bank hover:bg-paper"
            >
              <span
                aria-hidden="true"
                className="grid size-11 shrink-0 place-items-center rounded-full bg-gold-pale font-display font-semibold text-gold-deep"
              >
                {customer.firstName[0]}
              </span>
              <span>
                <span className="block font-semibold">{customer.name}</span>
                <span className="text-sm text-ink-soft">{customer.description}</span>
              </span>
            </button>
          ))}
        </form>
        <p className="pt-2 text-center text-sm text-ink-soft">
          No password: this is a demo. A real {p.kind} verifies its customers before Gold Savings
          opens.
        </p>
      </div>
    </>
  );
}
