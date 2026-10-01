/** Inline error for a form, shown after a redirect with ?error=… */
export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger-pale px-4 py-3 text-sm text-danger">
      {message}
    </p>
  );
}

export const primaryButton =
  "inline-flex w-full items-center justify-center rounded-2xl bg-bank px-5 py-3.5 font-semibold text-white hover:bg-bank-deep disabled:cursor-not-allowed disabled:bg-ink-soft/40";

export const quietButton =
  "inline-flex w-full items-center justify-center rounded-2xl border border-line px-5 py-3.5 font-semibold text-ink hover:bg-paper";

export const fieldClass =
  "w-full rounded-2xl border border-line bg-paper px-4 py-3.5 text-lg font-semibold text-ink placeholder:font-normal placeholder:text-ink-soft/60 focus:border-bank focus:outline-none";
