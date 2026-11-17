import Link from "next/link";
import { openAccount } from "@/app/actions";
import { FormError, fieldClass, primaryButton } from "@/components/ui";
import { MONTHLY_AMOUNTS, OCCUPATIONS, SOURCES_OF_FUNDS } from "@/lib/onboarding";
import { partner } from "@/lib/partner";

const label = "block font-semibold";
const select = `${fieldClass} text-base font-medium`;

/** Opening an account: the partner's KYC, simulated. MOHAR only sees the outcome. */
export default async function SignUp({ searchParams }: PageProps<"/signup">) {
  const { error } = await searchParams;
  const p = partner();
  return (
    <>
      <header className="flex items-center gap-3 bg-bank px-5 py-4 text-white">
        <Link
          href="/login"
          className="-ml-1 rounded-full px-2 py-1 text-lg leading-none hover:bg-white/10"
          aria-label="Back"
        >
          ‹
        </Link>
        <span className="font-display text-lg font-semibold">Open your {p.name} account</span>
      </header>

      <form action={openAccount} className="space-y-5 p-5">
        <FormError message={typeof error === "string" ? error : undefined} />
        <p className="rounded-xl bg-gold-pale px-4 py-3 text-sm text-gold-deep">
          Demo only. The CNIC check, screening and risk score are simulated, and the photo is not
          kept. Use made-up details.
        </p>

        <fieldset className="space-y-4">
          <legend className="mb-1 font-display text-lg font-semibold">Your identity</legend>
          <div className="space-y-2">
            <label htmlFor="fullName" className={label}>
              Full name, as on your CNIC
            </label>
            <input
              id="fullName"
              name="fullName"
              required
              autoComplete="name"
              className={fieldClass}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="cnic" className={label}>
              CNIC number
            </label>
            <input
              id="cnic"
              name="cnic"
              required
              inputMode="numeric"
              placeholder="35202-1234567-1"
              className={fieldClass}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="dateOfBirth" className={label}>
              Date of birth
            </label>
            <input
              id="dateOfBirth"
              name="dateOfBirth"
              type="date"
              required
              className={fieldClass}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="phone" className={label}>
              Mobile number
            </label>
            <input
              id="phone"
              name="phone"
              required
              inputMode="tel"
              autoComplete="tel"
              placeholder="0300 1234567"
              className={fieldClass}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="cnicFront" className={label}>
              Photo of the front of your CNIC
            </label>
            <input
              id="cnicFront"
              name="cnicFront"
              type="file"
              accept="image/*"
              capture="environment"
              required
              className="block w-full text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-bank file:px-4 file:py-2.5 file:font-semibold file:text-white"
            />
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-1 font-display text-lg font-semibold">About your savings</legend>
          <div className="space-y-2">
            <label htmlFor="occupation" className={label}>
              Occupation
            </label>
            <select id="occupation" name="occupation" required defaultValue="" className={select}>
              <option value="" disabled>
                Choose one
              </option>
              {Object.entries(OCCUPATIONS).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="sourceOfFunds" className={label}>
              Where the money for gold comes from
            </label>
            <select
              id="sourceOfFunds"
              name="sourceOfFunds"
              required
              defaultValue=""
              className={select}
            >
              <option value="" disabled>
                Choose one
              </option>
              {Object.entries(SOURCES_OF_FUNDS).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor="monthlyAmount" className={label}>
              How much gold you expect to buy each month
            </label>
            <select
              id="monthlyAmount"
              name="monthlyAmount"
              required
              defaultValue=""
              className={select}
            >
              <option value="" disabled>
                Choose one
              </option>
              {Object.entries(MONTHLY_AMOUNTS).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="politicallyExposed"
              value="yes"
              className="mt-1 accent-bank"
            />
            <span>
              I hold, or have held, a senior public office, or am a close family member of someone
              who has
            </span>
          </label>
        </fieldset>

        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="consent" value="yes" required className="mt-1 accent-bank" />
          <span>
            I agree that {p.name} verifies my identity and opens Gold Savings for me. Gold is bought
            and sold at the price shown, settled on the spot, with flat fees and no interest.
          </span>
        </label>

        <button type="submit" className={primaryButton}>
          Open account
        </button>
      </form>
    </>
  );
}
