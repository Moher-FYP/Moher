import Link from "next/link";
import { redirect } from "next/navigation";
import { FormError, primaryButton, quietButton } from "@/components/ui";
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
    { label: "Mobile number", detail: record.phoneMasked, done: true },
    { label: "Sanctions screening", detail: "No match on the simulated list", done: true },
    {
      label: "Risk assessment",
      detail: `${RISK[record.riskBand]} risk${opened ? "" : ": a compliance officer must review it"}`,
      done: opened,
    },
    {
      label: "Gold Savings opened",
      detail: opened ? `${p.kycLabel}. Your gold is recorded on Polygon` : "Waiting for review",
      done: opened && !error,
    },
  ];

  return (
    <>
      <header className="bg-bank px-6 pt-8 pb-6 text-white">
        <p className="text-white/80">{p.name}</p>
        <h1 className="mt-2 font-display text-2xl font-semibold">
          {opened ? `Welcome, ${customer.firstName}` : "Your application is being reviewed"}
        </h1>
      </header>
      <section className="space-y-5 p-5">
        <FormError message={typeof error === "string" ? error : undefined} />
        <ol className="space-y-3">
          {steps.map((step) => (
            <li key={step.label} className="flex gap-3">
              <span
                aria-hidden="true"
                className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  step.done ? "bg-bank text-white" : "border border-line text-ink-soft"
                }`}
              >
                {step.done ? "✓" : "…"}
              </span>
              <span>
                <span className="block font-semibold">{step.label}</span>
                <span className="text-sm text-ink-soft">{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>
        {opened ? (
          <Link href="/" className={primaryButton}>
            Go to Gold Savings
          </Link>
        ) : (
          <p className="text-sm text-ink-soft">
            Applications assessed as high risk need a person to look at them before an account
            opens. In this demo that review never happens.
          </p>
        )}
        <Link href="/login" className={quietButton}>
          Back to sign in
        </Link>
      </section>
    </>
  );
}
