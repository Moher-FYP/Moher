"use client";

import { useRef, useState } from "react";
import { BackHeader, RoundIcon, StepBar, fieldClass, primaryButton } from "./kit";

type Options = Record<string, string>;

const label = "mb-1.5 block text-sm font-bold";
const hint = "mt-1.5 text-[13px] text-ink-soft";
const check = "mt-0.5 size-5 shrink-0 accent-ink";

/**
 * Opening an account in two steps (canvas: Open an account, steps 1 and 2), as one form, so the
 * server action still receives every field at once. Step 1 must be valid before step 2 shows;
 * the browser's own checks report what is missing.
 */
export function SignupForm({
  action,
  partnerName,
  word,
  occupations,
  sources,
  amounts,
}: {
  action: (formData: FormData) => Promise<void>;
  partnerName: string;
  word: string;
  occupations: Options;
  sources: Options;
  amounts: Options;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [photo, setPhoto] = useState<string>();
  const first = useRef<HTMLDivElement>(null);

  const next = () => {
    const fields = first.current?.querySelectorAll<HTMLInputElement>("input, select") ?? [];
    for (const field of fields) {
      if (!field.checkValidity()) {
        field.reportValidity();
        return;
      }
    }
    setStep(2);
    window.scrollTo({ top: 0 });
  };

  return (
    <form
      action={action}
      onSubmit={(event) => {
        // Enter in a step 1 field moves on to step 2 instead of sending a half-filled form.
        if (step === 1) {
          event.preventDefault();
          next();
        }
      }}
      className="flex flex-1 flex-col"
    >
      {step === 1 ? (
        <BackHeader title="Open an account" backHref="/login" />
      ) : (
        <header className="flex items-center gap-3 px-5 pt-4 pb-2">
          <button
            type="button"
            onClick={() => setStep(1)}
            aria-label="Back to step 1"
            className="ring-line grid size-11 shrink-0 place-items-center rounded-full bg-surface text-ink hover:bg-page"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className="flex-1 font-display text-xl font-extrabold tracking-[-0.02em]">
            Open an account
          </h1>
        </header>
      )}

      <div ref={first} hidden={step !== 1} className="flex flex-col gap-3.5 px-5 pt-2">
        <StepBar n={1} total={2} label="Your identity" />
        <p className="text-sm leading-normal text-ink-soft">
          We check these against NADRA (simulated in this demo; use made-up details). It takes about
          2 minutes.
        </p>
        <div>
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
        <div>
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
          <p className={hint}>13 digits, as printed on the card</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label htmlFor="cnicExpiry" className={label}>
              CNIC expiry
            </label>
            <input
              id="cnicExpiry"
              name="cnicExpiry"
              type="date"
              className={`${fieldClass} px-3 text-sm`}
            />
          </div>
          <div>
            <label htmlFor="dateOfBirth" className={label}>
              Date of birth
            </label>
            <input
              id="dateOfBirth"
              name="dateOfBirth"
              type="date"
              required
              className={`${fieldClass} px-3 text-sm`}
            />
          </div>
        </div>
        <label className="flex items-start gap-3 text-sm leading-[1.45] text-ink-soft">
          <input type="checkbox" name="cnicLifetime" value="yes" className={check} />
          <span>My CNIC has lifetime validity</span>
        </label>
        <div>
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
          <p className={hint}>One account per number.</p>
        </div>
        <div>
          <p className={label}>Photo of your CNIC (front)</p>
          <label
            htmlFor="cnicFront"
            className="flex cursor-pointer items-center gap-3 rounded-2xl border-[1.5px] border-dashed border-[#cdbfa9] bg-surface px-4 py-3.5 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-seal"
          >
            <RoundIcon
              name={photo ? "check" : "camera"}
              tone={photo ? "bg-ok-pale text-ok" : "bg-sand text-ink"}
              size={40}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold">
                {photo ?? "Take or upload a photo"}
              </span>
              <span className="text-[13px] text-ink-soft">
                JPG or PNG, up to 5 MB. Checked, never kept.
              </span>
            </span>
            <input
              id="cnicFront"
              name="cnicFront"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              capture="environment"
              required
              onChange={(e) => setPhoto(e.target.files?.[0]?.name)}
              className="sr-only"
            />
          </label>
        </div>
      </div>

      <div hidden={step !== 2} className="flex flex-col gap-3.5 px-5 pt-2">
        <StepBar n={2} total={2} label="About your savings" />
        <p className="text-sm leading-normal text-ink-soft">
          {word === "Bank" ? "Banks" : "Wallets"} must ask this by law. It sets your limits; it
          never decides your price.
        </p>
        {(
          [
            ["occupation", "Occupation", occupations],
            ["sourceOfFunds", "Where the money for gold comes from", sources],
            ["monthlyAmount", "How much gold you expect to buy each month", amounts],
          ] as const
        ).map(([name, text, options]) => (
          <div key={name}>
            <label htmlFor={name} className={label}>
              {text}
            </label>
            <select id={name} name={name} required defaultValue="" className={fieldClass}>
              <option value="" disabled>
                Choose one
              </option>
              {Object.entries(options).map(([value, t]) => (
                <option key={value} value={value}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        ))}
        <label className="ring-line flex items-start gap-3 rounded-[22px] bg-surface px-4 py-3.5 text-sm leading-[1.45] text-ink-soft">
          <input type="checkbox" name="politicallyExposed" value="yes" className={check} />
          <span>
            I hold, or have held, a senior public office, or am a close relative or associate of
            someone who has
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm leading-[1.45] text-ink-soft">
          <input type="checkbox" name="consent" value="yes" required className={check} />
          <span>
            I agree that {partnerName} verifies my identity and opens Gold Savings for me. Gold is
            bought and sold at the price shown, settled on the spot, with flat fees and no interest.
          </span>
        </label>
      </div>

      <div className="mt-auto flex flex-col gap-2.5 px-5 pt-3 pb-7">
        {step === 1 ? (
          <button type="button" onClick={next} className={primaryButton}>
            Continue
          </button>
        ) : (
          <>
            <p className="mb-0.5 text-center text-[13px] leading-[1.45] text-ink-soft">
              Your CNIC stays with the {word === "Bank" ? "bank" : "wallet"}. The gold provider only
              receives a reference to your record.
            </p>
            <button type="submit" className={primaryButton}>
              Verify and open
            </button>
          </>
        )}
      </div>
    </form>
  );
}
