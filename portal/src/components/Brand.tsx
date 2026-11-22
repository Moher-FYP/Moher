import { SEAL_PATH, SEAL_VIEWBOX } from "./seal-path";

const [, , W, H] = SEAL_VIEWBOX.split(" ").map(Number) as [number, number, number, number];

/** The MOHAR seal, in seal orange. Decorative. */
export function Seal({ height = 22 }: { height?: number }) {
  return (
    <svg
      viewBox={SEAL_VIEWBOX}
      width={Math.round(((height * W) / H) * 10) / 10}
      height={height}
      aria-hidden="true"
      className="shrink-0 text-seal"
    >
      <path fill="currentColor" fillRule="evenodd" d={SEAL_PATH} />
    </svg>
  );
}

/** "MOHAR + seal · Partner Portal": the same wordmark as MOHAR Bank and MOHAR Wallet. */
export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mark leading-none text-ink" style={{ fontSize: size }}>
        MOHAR
      </span>
      <Seal height={Math.round(size * 0.9)} />
      <span className="ml-1 text-xs font-semibold text-ink-faint">Partner Portal</span>
    </span>
  );
}
