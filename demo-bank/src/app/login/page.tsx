import { signIn } from "@/app/actions";
import { FormError } from "@/components/ui";
import { CUSTOMERS } from "@/lib/customers";

export default async function Login({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <>
      <header className="bg-bank px-6 pt-10 pb-8 text-white">
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-xl bg-white font-display font-bold text-bank"
        >
          DB
        </span>
        <h1 className="mt-6 font-display text-3xl font-semibold">Demo Bank</h1>
        <p className="mt-2 text-white/80">
          A mock partner bank for the MOHAR demo. Sign in as one of the customers from the FYP
          personas.
        </p>
      </header>
      <form action={signIn} className="space-y-3 p-5">
        <FormError message={typeof error === "string" ? error : undefined} />
        {CUSTOMERS.map((customer) => (
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
        <p className="pt-2 text-center text-sm text-ink-soft">
          No password: this is a demo. Real KYC happens in the bank before Gold Savings opens.
        </p>
      </form>
    </>
  );
}
