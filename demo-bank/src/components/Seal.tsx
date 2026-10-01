/**
 * A goldsmith's hallmark. MOHAR means "seal" — this stamp marks gold that is allocated in the
 * vault and checkable on-chain. Decorative; the text is for sighted users only.
 */
export function Seal({ size = 76 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="shrink-0">
      <defs>
        <path id="seal-ring" d="M50,50 m-36,0 a36,36 0 1,1 72,0 a36,36 0 1,1 -72,0" />
      </defs>
      <circle
        cx="50"
        cy="50"
        r="47"
        fill="none"
        stroke="#2c1f05"
        strokeOpacity="0.55"
        strokeWidth="1.5"
      />
      <circle
        cx="50"
        cy="50"
        r="27"
        fill="none"
        stroke="#2c1f05"
        strokeOpacity="0.55"
        strokeWidth="1.2"
      />
      <text fontSize="9.5" letterSpacing="1.6" fill="#2c1f05" fillOpacity="0.75" fontWeight="600">
        <textPath href="#seal-ring">24K GOLD · FULLY ALLOCATED · VAULT ·</textPath>
      </text>
      <text
        x="50"
        y="55"
        textAnchor="middle"
        fontSize="15"
        fontWeight="700"
        fill="#2c1f05"
        style={{ fontFamily: "var(--font-display)" }}
      >
        999.9
      </text>
    </svg>
  );
}
