import { openAccount } from "@/app/actions";
import { FormError } from "@/components/kit";
import { SignupForm } from "@/components/SignupForm";
import { MONTHLY_AMOUNTS, OCCUPATIONS, SOURCES_OF_FUNDS } from "@/lib/onboarding";
import { partner } from "@/lib/partner";

/** Opening an account: the partner's KYC, simulated. MOHAR only sees the outcome. */
export default async function SignUp({ searchParams }: PageProps<"/signup">) {
  const { error } = await searchParams;
  const p = partner();
  return (
    <>
      {typeof error === "string" ? (
        <div className="px-5 pt-4">
          <FormError message={error} />
        </div>
      ) : null}
      <SignupForm
        action={openAccount}
        partnerName={p.name}
        word={p.word}
        occupations={OCCUPATIONS}
        sources={SOURCES_OF_FUNDS}
        amounts={MONTHLY_AMOUNTS}
      />
    </>
  );
}
