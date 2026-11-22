import Link from "next/link";
import { signIn } from "@/app/actions";
import {
  Actions,
  Chip,
  FormError,
  Icon,
  TrustRow,
  Wordmark,
  primaryButton,
} from "@/components/kit";
import { allCustomers } from "@/lib/customers";
import { initials } from "@/lib/format";
import { partner } from "@/lib/partner";

const AVATAR_TONES = ["bg-sand", "bg-apricot", "bg-sky", "bg-sage"];

export default async function Login({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const p = partner();
  return (
    <>
      <section className="mx-4 mt-3 rounded-[32px] bg-hero px-6 pt-[26px] pb-6">
        <Wordmark word={p.word} size={28} />
        <h1 className="mt-7 font-display text-[36px] leading-[1.02] font-extrabold tracking-[-0.035em]">
          Save in real gold, from Rs&nbsp;{p.fromPkr.toLocaleString("en-PK")}
        </h1>
        <p className="mt-3 text-[15px] text-ink-soft">{p.tagline}.</p>
        <p className="mt-4">
          <Chip tone="bg-white/70 text-ink">Demo app · gold provided by MOHAR</Chip>
        </p>
      </section>

      <div className="flex flex-col gap-2.5 px-5 pt-5">
        <FormError message={typeof error === "string" ? error : undefined} />
        <TrustRow />
        <p className="mt-2 text-sm font-bold text-ink-soft">Continue as a demo customer</p>
        <form action={signIn} className="flex flex-col gap-2.5">
          {allCustomers().map((customer, i) => (
            <button
              key={customer.id}
              type="submit"
              name="customer"
              value={customer.id}
              className="ring-line flex w-full items-center gap-3.5 rounded-[20px] bg-surface px-3.5 py-3 text-left hover:bg-page"
            >
              <span
                aria-hidden="true"
                className={`grid size-[42px] shrink-0 place-items-center rounded-full font-display text-sm font-extrabold ${AVATAR_TONES[i % AVATAR_TONES.length]}`}
              >
                {initials(customer.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{customer.name}</span>
                <span className="block text-[13px] leading-[1.35] text-ink-soft">
                  {customer.onboarding?.outcome === "referred"
                    ? "Application under review"
                    : customer.description}
                </span>
              </span>
              <Icon name="chev" size={18} className="text-ink-soft" />
            </button>
          ))}
        </form>
      </div>

      <Actions note={`Demo only: no password. A real ${p.kind} verifies you first.`}>
        <Link href="/signup" className={primaryButton}>
          Open a new account
        </Link>
      </Actions>
    </>
  );
}
