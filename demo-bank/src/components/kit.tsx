import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/actions";
import { SEAL_PATH, SEAL_VIEWBOX } from "./seal-path";

/**
 * The partner app's parts, one for each part on the design canvas's Components board. Every
 * screen is built from these, so MOHAR Bank and MOHAR Wallet stay one family; only the three
 * partner colours (primary, on-primary, hero) differ.
 */

// ---------------------------------------------------------------- icons and marks

const ICONS = {
  buy: (
    <>
      <path d="M12 4v13" />
      <path d="M6 11l6 6 6-6" />
      <path d="M5 20h14" />
    </>
  ),
  sell: (
    <>
      <path d="M12 20V7" />
      <path d="M6 13l6-6 6 6" />
      <path d="M5 4h14" />
    </>
  ),
  send: (
    <>
      <path d="M21 3L10 14" />
      <path d="M21 3l-7 18-4-7-7-4 18-7z" />
    </>
  ),
  receive: (
    <>
      <path d="M3 21l11-11" />
      <path d="M3 21l7-18 4 7 7 4-18 7z" />
    </>
  ),
  back: <path d="M15 18l-6-6 6-6" />,
  chev: <path d="M9 18l6-6-6-6" />,
  check: <path d="M20 6L9 17l-5-5" />,
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  print: (
    <>
      <path d="M7 9V3h10v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M7 14h10v7H7z" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6L6 18" />,
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  swap: (
    <>
      <path d="M7 7h13l-4-4" />
      <path d="M17 17H4l4 4" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M3 10h18" />
    </>
  ),
  del: (
    <>
      <path d="M9 5h11v14H9l-6-7z" />
      <path d="M13 9l4 6M17 9l-4 6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  pause: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9v6M14 9v6" />
    </>
  ),
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 22,
  stroke = 2,
  className,
}: {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {ICONS[name]}
    </svg>
  );
}

const [, , SEAL_W, SEAL_H] = SEAL_VIEWBOX.split(" ").map(Number) as [
  number,
  number,
  number,
  number,
];

/** The MOHAR seal. Decorative unless given a label. */
export function Seal({
  height = 22,
  className = "text-seal",
  label,
}: {
  height?: number;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      viewBox={SEAL_VIEWBOX}
      width={Math.round(((height * SEAL_W) / SEAL_H) * 10) / 10}
      height={height}
      className={`shrink-0 ${className}`}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <path fill="currentColor" fillRule="evenodd" d={SEAL_PATH} />
    </svg>
  );
}

/** "MOHAR Bank" + seal: the partner's wordmark. */
export function Wordmark({ word, size = 24 }: { word: string; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="font-mark leading-none tracking-[-0.01em] text-ink"
        style={{ fontSize: size }}
      >
        MOHAR
      </span>
      <span
        className="font-display font-bold tracking-[-0.01em] text-ink-soft"
        style={{ fontSize: Math.round(size * 0.72) }}
      >
        {word}
      </span>
      <Seal height={Math.round(size * 0.9)} />
    </span>
  );
}

// ---------------------------------------------------------------- buttons

/** Primary: one per screen, at the bottom, in the partner's colour. */
export const primaryButton =
  "flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-[17px] font-bold text-on-primary transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";

/** Secondary: white with a line. */
export const quietButton =
  "ring-line-strong flex h-13 w-full items-center justify-center gap-2 rounded-full bg-surface px-6 text-base font-bold text-ink transition hover:bg-page disabled:opacity-40";

/** A text field or select, 52 px tall. */
export const fieldClass =
  "ring-line-strong h-13 w-full rounded-2xl border-0 bg-surface px-4 text-base font-semibold text-ink placeholder:font-normal placeholder:text-ink-faint focus:shadow-[inset_0_0_0_2px_var(--color-ink)] focus:outline-none";

// ---------------------------------------------------------------- headers

/** Screen header with a round back button and a title. */
export function BackHeader({
  title,
  backHref,
  right,
}: {
  title: string;
  backHref: string;
  right?: ReactNode;
}) {
  return (
    <header className="flex items-center gap-3 px-5 pt-4 pb-2 print:hidden">
      <Link
        href={backHref}
        aria-label="Back"
        className="ring-line grid size-11 shrink-0 place-items-center rounded-full bg-surface text-ink hover:bg-page"
      >
        <Icon name="back" size={20} />
      </Link>
      <h1 className="min-w-0 flex-1 truncate font-display text-xl font-extrabold tracking-[-0.02em]">
        {title}
      </h1>
      {right}
    </header>
  );
}

/** Home header: the partner's wordmark and the customer's initials, which sign out. */
export function HomeHeader({
  word,
  initials,
  name,
}: {
  word: string;
  initials: string;
  name: string;
}) {
  return (
    <header className="flex items-center justify-between px-5 pt-5 pb-2">
      <Wordmark word={word} />
      <form action={signOut}>
        <button
          type="submit"
          aria-label={`${name}: sign out`}
          title="Sign out"
          className="grid size-11 place-items-center rounded-full bg-ink font-display text-sm font-bold text-white hover:bg-ink-soft"
        >
          {initials}
        </button>
      </form>
    </header>
  );
}

// ---------------------------------------------------------------- surfaces

/** The gold card. `label` names the section for screen readers too. */
export function GoldCard({
  grams,
  pkr,
  sub,
  label = "Gold savings",
  big = 46,
  delta,
  title,
}: {
  grams: string;
  pkr: ReactNode;
  sub: ReactNode;
  label?: string;
  big?: number;
  delta?: string;
  title?: string;
}) {
  return (
    <section
      aria-label={label}
      className="gold-card settle-in relative overflow-hidden rounded-[28px] px-[22px] pt-[22px] pb-5"
    >
      <span className="absolute top-5 right-5 text-[#3c2300] opacity-[0.28]">
        <Seal height={40} className="" />
      </span>
      <p className="text-sm font-bold text-[#3d2a06]">{label}</p>
      <p
        className="mt-2 font-display leading-none font-extrabold tracking-[-0.035em]"
        style={{ fontSize: big }}
        title={title}
      >
        {grams}
        <span className="ml-1 font-bold" style={{ fontSize: Math.round(big * 0.5) }}>
          g
        </span>
      </p>
      <p className="mt-2 text-lg font-bold">{pkr}</p>
      <p className="mt-4 pr-24 text-[13px] font-semibold text-[#3d2a06]">{sub}</p>
      {delta ? (
        <span className="absolute right-5 bottom-[18px] rounded-full bg-white/55 px-2.5 py-1 text-[13px] font-bold text-[#1f5132]">
          {delta}
        </span>
      ) : null}
    </section>
  );
}

export function Panel({
  children,
  className = "p-[18px]",
  tone = "bg-surface",
}: {
  children: ReactNode;
  className?: string;
  tone?: string;
}) {
  return <div className={`ring-line rounded-[22px] ${tone} ${className}`}>{children}</div>;
}

/** Label and value rows, with an optional total under a heavy rule. */
export function Rows({
  items,
  total,
}: {
  items: [ReactNode, ReactNode][];
  total?: [ReactNode, ReactNode];
}) {
  return (
    <dl>
      {items.map(([k, v], i) => (
        <div
          key={i}
          className={`flex justify-between gap-4 py-3 text-[15px] ${i ? "border-t border-line" : ""}`}
        >
          <dt className="text-ink-soft">{k}</dt>
          <dd className="text-right font-semibold">{v}</dd>
        </div>
      ))}
      {total ? (
        <div className="flex justify-between gap-4 border-t-[1.5px] border-ink pt-3.5 pb-0.5 text-[17px]">
          <dt className="font-bold">{total[0]}</dt>
          <dd className="text-right font-display font-extrabold">{total[1]}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export function Chip({
  children,
  tone = "bg-surface text-ink",
  dot,
}: {
  children: ReactNode;
  tone?: string;
  dot?: string;
}) {
  return (
    <span
      className={`ring-line inline-flex items-center gap-2 rounded-full px-3 py-[7px] text-[13px] font-bold ${tone}`}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className="size-2 rounded-full"
          style={{ background: dot, boxShadow: `0 0 0 4px ${dot}2e` }}
        />
      ) : null}
      {children}
    </span>
  );
}

export function RoundIcon({
  name,
  tone = "bg-sand text-ink",
  size = 44,
}: {
  name: IconName;
  tone?: string;
  size?: number;
}) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full ${tone}`}
      style={{ width: size, height: size }}
    >
      <Icon name={name} size={Math.round(size * 0.45)} />
    </span>
  );
}

export function SectionTitle({
  children,
  as: As = "h2",
}: {
  children: ReactNode;
  as?: "h2" | "h3";
}) {
  return <As className="font-display text-[17px] font-extrabold tracking-[-0.02em]">{children}</As>;
}

/** Error after a refused action (?error=…), in the kit's quiet red. */
export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-2xl bg-danger-pale px-4 py-3 text-sm text-danger">
      {message}
    </p>
  );
}

/** The bottom of a screen: an optional note, then the buttons. */
export function Actions({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-auto flex flex-col gap-2.5 px-5 pt-3 pb-7 print:hidden">
      {note ? (
        <p className="mb-0.5 text-center text-[13px] leading-[1.45] text-ink-soft">{note}</p>
      ) : null}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- rows, steps, bars

export function ActivityRow({
  href,
  icon,
  iconTone,
  name,
  sub,
  amount,
  tone = "text-ink",
  strike,
  first,
}: {
  href: string;
  icon: IconName;
  iconTone: string;
  name: string;
  sub: string;
  amount: string;
  tone?: string;
  strike?: boolean;
  first?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 py-3 text-ink ${first ? "" : "border-t border-line"}`}
    >
      <RoundIcon name={icon} tone={`${iconTone} text-ink`} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold">{name}</span>
        <span className="text-[13px] text-ink-soft">{sub}</span>
      </span>
      <span
        className={`font-display text-[15px] font-extrabold ${strike ? "text-ink-faint line-through" : tone}`}
      >
        {amount}
      </span>
    </Link>
  );
}

export interface Step {
  label: string;
  sub: string;
}

/** Vertical progress: done steps green, the current one ringed, a failed one marked. */
export function Stepper({
  steps,
  reached,
  failed,
}: {
  steps: Step[];
  reached: number;
  failed?: number;
}) {
  return (
    <ol aria-live="polite">
      {steps.map((step, i) => {
        const fail = i === failed;
        const done = i < reached && !fail;
        const current = i === reached && !fail;
        return (
          <li key={step.label} className="relative flex gap-3.5 pb-[18px]">
            {fail ? (
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#b4542a] text-white">
                <Icon name="x" size={16} stroke={3} />
              </span>
            ) : (
              <span
                className={`grid size-8 shrink-0 place-items-center rounded-full text-white ${done ? "bg-ok" : "bg-surface"}`}
                style={{
                  boxShadow: `inset 0 0 0 2px ${done ? "var(--color-ok)" : current ? "var(--color-ink)" : "var(--color-line)"}`,
                }}
              >
                {done ? (
                  <Icon name="check" size={16} stroke={3} />
                ) : current ? (
                  <span className="size-2.5 rounded-full bg-ink" />
                ) : null}
              </span>
            )}
            {i < steps.length - 1 && !fail ? (
              <span
                aria-hidden="true"
                className={`absolute top-[34px] -bottom-3.5 left-[15px] w-0.5 ${done ? "bg-ok" : "bg-line"}`}
              />
            ) : null}
            <span>
              <span
                className={`block font-bold ${done || current || fail ? "text-ink" : "text-ink-faint"}`}
              >
                {step.label}
                {done ? <span className="sr-only"> (done)</span> : null}
                {current ? <span className="sr-only"> (in progress)</span> : null}
              </span>
              <span className="text-[13px] text-ink-soft">{step.sub}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function StepBar({ n, total, label }: { n: number; total: number; label: string }) {
  return (
    <div>
      <p className="mb-2 text-[13px] font-bold text-ink-soft">
        Step {n} of {total} · {label}
      </p>
      <div className="flex gap-1.5" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-md ${i < n ? "bg-ink" : "bg-line"}`} />
        ))}
      </div>
    </div>
  );
}

export function TrustRow() {
  const items: [IconName, string][] = [
    ["shield", "Every gram is real gold in a vault, in your name"],
    ["lock", "Price fixed before you pay; no hidden spread"],
    ["check", "Reserve checked after every trade, in public"],
  ];
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map(([icon, text]) => (
        <li key={text} className="flex items-center gap-2.5 text-[13.5px] text-ink-soft">
          <RoundIcon name={icon} tone="ring-line bg-surface text-ink" size={30} />
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The partner app's own tab bar, to show Gold Savings living inside a bigger app. Only Gold is
 * part of this demo; the other tabs are shown, not linked.
 */
export function TabBar({ word }: { word: string }) {
  const others: [string, IconName][] = [
    ["Home", "home"],
    ["Payments", "swap"],
  ];
  const item = "flex flex-col items-center gap-1 py-2 text-[11.5px]";
  return (
    <nav
      aria-label={`${word} app`}
      className="sticky bottom-0 mt-auto grid grid-cols-4 bg-page/95 px-3 pt-1.5 pb-5 shadow-[0_-1px_0_var(--color-line)] backdrop-blur print:hidden"
    >
      {others.map(([label, icon]) => (
        <span
          key={label}
          aria-disabled="true"
          title="Not part of this demo"
          className={`${item} font-semibold text-ink-faint`}
        >
          <span className="grid h-6 place-items-center">
            <Icon name={icon} />
          </span>
          {label}
        </span>
      ))}
      <Link href="/" aria-current="page" className={`${item} font-bold text-ink`}>
        <span className="grid h-6 place-items-center">
          <Seal height={18} />
        </span>
        Gold
      </Link>
      <span
        aria-disabled="true"
        title="Not part of this demo"
        className={`${item} font-semibold text-ink-faint`}
      >
        <span className="grid h-6 place-items-center">
          <Icon name="card" />
        </span>
        Cards
      </span>
    </nav>
  );
}

/** Big centred figure with a label above and a conversion line below (buy, sell, confirm). */
export function BigFigure({
  label,
  prefix,
  value,
  suffix,
  conversion,
  caret,
}: {
  label: string;
  prefix?: string;
  value: string;
  suffix?: string;
  conversion?: ReactNode;
  caret?: boolean;
}) {
  const side = "font-display text-[28px] font-bold text-ink-soft";
  const size = value.length > 8 ? "text-[46px]" : "text-[60px]";
  return (
    <section aria-label={label} className="pt-2.5 pb-1 text-center">
      <p className="text-sm font-semibold text-ink-soft">{label}</p>
      <p className="mt-2.5 flex items-baseline justify-center gap-1.5" aria-live="polite">
        {prefix ? <span className={side}>{prefix}</span> : null}
        <span className={`font-display ${size} leading-none font-extrabold tracking-[-0.045em]`}>
          {value}
        </span>
        {suffix ? <span className={side}>{suffix}</span> : null}
        {caret ? (
          <span
            aria-hidden="true"
            className="ml-0.5 h-[50px] w-[3px] self-center rounded-sm bg-seal"
          />
        ) : null}
      </p>
      {conversion ? <p className="mt-2.5 text-sm text-ink-soft">{conversion}</p> : null}
    </section>
  );
}
