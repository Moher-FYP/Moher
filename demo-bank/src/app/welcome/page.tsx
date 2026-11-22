import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Actions,
  BackHeader,
  FormError,
  Panel,
  RoundIcon,
  primaryButton,
  quietButton,
} from "@/components/kit";
import { partner } from "@/lib/partner";
import { currentCustomer } from "@/lib/session";

const RISK = { low: "Low", medium: "Medium", high: "High" } as const;

/** What happened when the account was opened, step by step. */
export default async function Welcome({ searchParams }: PageProps<"/welcome">) {
  const customer = await currentCustomer();
  if (!customer?.onboarding) redirect("/");
  const { error } = await searchParams;
  const p = partner();
  const record = customer.onboarding;
  const opened = record.outcome === "opened";

  const steps: { label: string; detail: string; done: boolean }[] = [
    {
      label: "CNIC captured",
      detail: `${record.cnicMasked}, read by a simulated reader`,
      done: true,
    },
    { label: "Identity verified", detail: "Simulated NADRA check", done: true },
    { label: "Mobile number", detail: `${record.phoneMasked}, registered to you`, done: true },
    { label: "Sanctions screening", detail: "No match on the simulated list", done: true },
    {
      label: "Risk assessment",
      detail: `${RISK[record.riskBand]}${opened ? ` · ${p.kycLabel}` : ": a compliance officer must review it"}`,
      done: opened,
    },
    {
      label: "Gold Savings opened",
      detail: opened ? "Your gold is recorded on the public ledger" : "Waiting for review",
      done: opened && !error,
    },
  ];

  return (
    <>
      <BackHeader title={opened ? "Account opened" : "Application received"} backHref="/login" />
      <div className="flex flex-col gap-3.5 px-5 pt-2">
        <FormError message={typeof error === "string" ? error : undefined} />
        <section className="rounded-[32px] bg-hero px-[22px] py-6">
          <RoundIcon
            name={opened ? "check" : "clock"}
            tone={opened ? "bg-ok text-white" : "bg-white/80 text-ink"}
            size={48}
          />
          <h2 className="mt-4 font-display text-[32px] leading-[1.05] font-extrabold tracking-[-0.035em]">
            {opened ? `Welcome, ${customer.firstName}` : "Your application is being reviewed"}
          </h2>
          <p className="mt-2 text-[15px] text-ink-soft">
            {opened
              ? `Your gold savings account is open. Start with as little as Rs ${p.fromPkr.toLocaleString("en-PK")}.`
              : "Applications assessed as high risk need a person to look at them before an account opens. In this demo that review never happens."}
          </p>
        </section>
        <Panel className="px-[18px] py-1">
          <ul>
            {steps.map((step, i) => (
              <li
                key={step.label}
                className={`flex items-center gap-3 py-[11px] ${i ? "border-t border-line" : ""}`}
              >
                <RoundIcon
                  name={step.done ? "check" : "clock"}
                  tone={step.done ? "bg-ok-pale text-ok" : "bg-stone text-ink-soft"}
                  size={32}
                />
                <span>
                  <span className="block font-bold">
                    {step.label}
                    {step.done ? null : <span className="sr-only"> (not done)</span>}
                  </span>
                  <span className="text-[13px] text-ink-soft">{step.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Actions>
        {opened ? (
          <>
            <Link href="/buy" className={primaryButton}>
              Buy your first gold
            </Link>
            <Link href="/" className={quietButton}>
              Go to home
            </Link>
          </>
        ) : (
          <Link href="/login" className={quietButton}>
            Back to sign in
          </Link>
        )}
      </Actions>
    </>
  );
}
