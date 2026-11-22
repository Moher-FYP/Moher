"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Small hand-drawn SVG charts for the analytics pages. No chart library: every mark is
 * plain SVG the team can read and defend, colours come from theme.css through Tailwind's
 * fill-* and stroke-* classes, and each chart carries a hidden table for screen readers.
 */

/** Width of the element, kept up to date as the window resizes. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry!.contentRect.width)),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** About `count` round tick values covering lo..hi (1, 2 or 5 times a power of ten). */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (hi === lo) return [lo];
  const raw = (hi - lo) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) {
    ticks.push(Number(t.toPrecision(12)));
  }
  return ticks;
}

function ScreenReaderTable({ caption, rows }: { caption: string; rows: [string, string][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>
        {rows.map(([a, b], i) => (
          <tr key={i}>
            <th scope="row">{a}</th>
            <td>{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x - 80, 0), Math.max(width - 160, 0));
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 w-40 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-xs shadow-sm"
      style={{ left }}
    >
      {children}
    </div>
  );
}

const PAD = { left: 64, right: 16, top: 12, bottom: 26 };

// ---------------------------------------------------------------- line

export interface LinePoint {
  label: string;
  value: number;
}

/**
 * A line over time. `hover` and `onHover` let two charts on one time axis share a cursor.
 * The y axis fits the data (a line, unlike a bar, need not start at zero).
 */
export function LineChart({
  data,
  format,
  axisFormat = format,
  height = 200,
  tone = "navy",
  caption,
  hover,
  onHover,
  showDates = true,
}: {
  data: LinePoint[];
  format: (n: number) => string;
  axisFormat?: (n: number) => string;
  height?: number;
  tone?: "navy" | "gold";
  caption: string;
  hover?: number | null;
  onHover?: (i: number | null) => void;
  showDates?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [ownHover, setOwnHover] = useState<number | null>(null);
  const active = hover !== undefined ? hover : ownHover;
  const setActive = onHover ?? setOwnHover;
  const bottom = showDates ? PAD.bottom : 8;
  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = height - PAD.top - bottom;
  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;
  const lo = min - span * 0.08;
  const hi = max + span * 0.08;
  const ticks = niceTicks(lo, hi, 3).filter((t) => t >= lo && t <= hi);
  const x = (i: number) =>
    PAD.left + (data.length > 1 ? (i / (data.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH;
  const path = data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.value)}`).join("");
  const stroke = tone === "navy" ? "stroke-navy" : "stroke-gold";
  const fill = tone === "navy" ? "fill-navy" : "fill-gold";
  const every = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div ref={ref} className="relative">
      {width > 0 && data.length > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={caption}
          onMouseLeave={() => setActive(null)}
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const i = Math.round(((e.clientX - box.left - PAD.left) / plotW) * (data.length - 1));
            setActive(Math.min(Math.max(i, 0), data.length - 1));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                className="stroke-line"
              />
              <text
                x={PAD.left - 8}
                y={y(t) + 4}
                textAnchor="end"
                className="fill-ink-faint text-[11px]"
              >
                {axisFormat(t)}
              </text>
            </g>
          ))}
          {showDates
            ? data.map((d, i) =>
                (i % every === 0 && data.length - 1 - i >= every) || i === data.length - 1 ? (
                  <text
                    key={d.label}
                    x={x(i)}
                    y={height - 8}
                    textAnchor={i === data.length - 1 ? "end" : "middle"}
                    className="fill-ink-faint text-[11px]"
                  >
                    {d.label}
                  </text>
                ) : null,
              )
            : null}
          <path d={path} fill="none" strokeWidth={2} className={stroke} />
          <circle cx={x(data.length - 1)} cy={y(values.at(-1)!)} r={3.5} className={fill} />
          {active !== null ? (
            <g>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={PAD.top}
                y2={height - bottom}
                className="stroke-ink-faint"
                strokeDasharray="3 3"
              />
              <circle
                cx={x(active)}
                cy={y(data[active]!.value)}
                r={4}
                className={`${fill} stroke-surface`}
                strokeWidth={2}
              />
            </g>
          ) : null}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {active !== null && data[active] && onHover === undefined ? (
        <Tooltip x={x(active)} width={width}>
          <p className="text-ink-faint">{data[active].label}</p>
          <p className="font-semibold text-ink">{format(data[active].value)}</p>
        </Tooltip>
      ) : null}
      <ScreenReaderTable caption={caption} rows={data.map((d) => [d.label, format(d.value)])} />
    </div>
  );
}

// ---------------------------------------------------------------- bars around zero

export interface FlowDay {
  label: string;
  up: number;
  down: number;
  net: number;
}

/** Buys as bars above zero, sales below, and the day's net as a dot. */
export function FlowBars({
  data,
  format,
  axisFormat = format,
  height = 220,
  caption,
}: {
  data: FlowDay[];
  format: (n: number) => string;
  axisFormat?: (n: number) => string;
  height?: number;
  caption: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = height - PAD.top - PAD.bottom;
  const top = Math.max(...data.map((d) => d.up), 0);
  const bottom = Math.max(...data.map((d) => d.down), 0);
  const ticks = niceTicks(-bottom, top, 5);
  const hi = Math.max(top, ticks.at(-1) ?? 0) || 1;
  const lo = Math.min(-bottom, ticks[0] ?? 0);
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * plotH;
  const slot = plotW / Math.max(data.length, 1);
  const barW = Math.max(Math.min(slot * 0.7, 18), 1.5);
  const cx = (i: number) => PAD.left + slot * (i + 0.5);
  const every = Math.max(1, Math.ceil(data.length / 6));

  return (
    <div ref={ref} className="relative">
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={caption}
          onMouseLeave={() => setActive(null)}
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const i = Math.floor((e.clientX - box.left - PAD.left) / slot);
            setActive(i >= 0 && i < data.length ? i : null);
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                className={t === 0 ? "stroke-ink-faint" : "stroke-line"}
              />
              <text
                x={PAD.left - 8}
                y={y(t) + 4}
                textAnchor="end"
                className="fill-ink-faint text-[11px]"
              >
                {axisFormat(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => (
            <g key={d.label} opacity={active === null || active === i ? 1 : 0.45}>
              {d.up > 0 ? (
                <rect
                  x={cx(i) - barW / 2}
                  y={y(d.up)}
                  width={barW}
                  height={y(0) - y(d.up)}
                  rx={1.5}
                  className="fill-navy"
                />
              ) : null}
              {d.down > 0 ? (
                <rect
                  x={cx(i) - barW / 2}
                  y={y(0)}
                  width={barW}
                  height={y(-d.down) - y(0)}
                  rx={1.5}
                  className="fill-gold"
                />
              ) : null}
              <circle
                cx={cx(i)}
                cy={y(d.net)}
                r={Math.min(barW / 2, 3)}
                strokeWidth={1.5}
                className="fill-surface stroke-ink"
              />
              {(i % every === 0 && data.length - 1 - i >= every) || i === data.length - 1 ? (
                <text
                  x={cx(i)}
                  y={height - 8}
                  textAnchor="middle"
                  className="fill-ink-faint text-[11px]"
                >
                  {d.label}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {active !== null && data[active] ? (
        <Tooltip x={cx(active)} width={width}>
          <p className="text-ink-faint">{data[active].label}</p>
          <p className="text-ink">Bought {format(data[active].up)}</p>
          <p className="text-ink">Sold {format(data[active].down)}</p>
          <p className="font-semibold text-ink">Net {format(data[active].net)}</p>
        </Tooltip>
      ) : null}
      <div className="mt-2 flex gap-4 text-xs text-ink-soft">
        <Legend className="bg-navy">Bought</Legend>
        <Legend className="bg-gold">Sold</Legend>
        <Legend className="border-[1.5px] border-ink bg-surface" round>
          Net
        </Legend>
      </div>
      <ScreenReaderTable
        caption={caption}
        rows={data.map((d) => [
          d.label,
          `bought ${format(d.up)}, sold ${format(d.down)}, net ${format(d.net)}`,
        ])}
      />
    </div>
  );
}

export function Legend({
  className,
  round = false,
  children,
}: {
  className: string;
  round?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={`inline-block h-2.5 w-2.5 ${round ? "rounded-full" : "rounded-[2px]"} ${className}`}
      />
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- waterfall

export interface WaterfallStep {
  label: string;
  value: number;
  total?: boolean;
}

/**
 * Opening total, the changes that took it to the closing total, and the closing total.
 * Totals are navy; a rise is green, a fall red, and each bar says its signed amount.
 */
export function Waterfall({
  steps,
  format,
  axisFormat = format,
  height = 240,
  caption,
}: {
  steps: WaterfallStep[];
  format: (n: number, signed?: boolean) => string;
  axisFormat?: (n: number) => string;
  height?: number;
  caption: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const bars: { label: string; from: number; to: number; total: boolean; value: number }[] = [];
  let level = 0;
  for (const s of steps) {
    if (s.total) {
      bars.push({ label: s.label, from: 0, to: s.value, total: true, value: s.value });
      level = s.value;
    } else {
      bars.push({ label: s.label, from: level, to: level + s.value, total: false, value: s.value });
      level += s.value;
    }
  }
  const top = Math.max(...bars.map((b) => Math.max(b.from, b.to)), 0);
  const ticks = niceTicks(0, top * 1.1, 4);
  const hi = Math.max(ticks.at(-1) ?? 0, top * 1.1) || 1;
  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = height - PAD.top - PAD.bottom - 18;
  const y = (v: number) => PAD.top + 18 + (1 - v / hi) * plotH;
  const slot = plotW / Math.max(bars.length, 1);
  const barW = Math.min(slot * 0.56, 72);
  const cx = (i: number) => PAD.left + slot * (i + 0.5);

  return (
    <div ref={ref}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={caption}>
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                className="stroke-line"
              />
              <text
                x={PAD.left - 8}
                y={y(t) + 4}
                textAnchor="end"
                className="fill-ink-faint text-[11px]"
              >
                {axisFormat(t)}
              </text>
            </g>
          ))}
          {bars.map((b, i) => {
            const y0 = y(Math.max(b.from, b.to));
            const h = Math.max(Math.abs(y(b.from) - y(b.to)), 1);
            const cls = b.total ? "fill-navy" : b.value >= 0 ? "fill-ok" : "fill-bad";
            return (
              <g key={b.label}>
                {i > 0 ? (
                  <line
                    x1={cx(i - 1) + barW / 2}
                    x2={cx(i) - barW / 2}
                    y1={y(bars[i - 1]!.to)}
                    y2={y(bars[i - 1]!.to)}
                    className="stroke-ink-faint"
                    strokeDasharray="2 3"
                  />
                ) : null}
                <rect x={cx(i) - barW / 2} y={y0} width={barW} height={h} rx={2} className={cls} />
                <text
                  x={cx(i)}
                  y={!b.total && b.value < 0 ? y0 + h + 14 : y0 - 6}
                  textAnchor="middle"
                  className="fill-ink text-[11.5px] font-semibold"
                >
                  {format(b.value, !b.total)}
                </text>
                <text
                  x={cx(i)}
                  y={height - 8}
                  textAnchor="middle"
                  className="fill-ink-soft text-[11.5px]"
                >
                  {b.label}
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      <ScreenReaderTable
        caption={caption}
        rows={bars.map((b) => [b.label, format(b.value, !b.total)])}
      />
    </div>
  );
}

// ---------------------------------------------------------------- horizontal bars

export interface ShareRow {
  label: string;
  count: number;
  tone: "navy" | "gold" | "ok" | "bad" | "warn" | "faint";
  note?: string;
}

const BAR_TONES = {
  navy: "bg-navy",
  gold: "bg-gold",
  ok: "bg-ok",
  bad: "bg-bad",
  warn: "bg-warn",
  faint: "bg-ink-faint",
} as const;

/** Labelled horizontal bars, each with its count and share of `total`. */
export function ShareBars({
  rows,
  total,
  caption,
}: {
  rows: ShareRow[];
  total: number;
  caption: string;
}) {
  return (
    <div>
      <ul className="space-y-3" aria-label={caption}>
        {rows.map((r) => {
          const pct = total > 0 ? (r.count / total) * 100 : 0;
          return (
            <li key={r.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink">
                  {r.label}
                  {r.note ? <span className="ml-1.5 text-xs text-ink-faint">{r.note}</span> : null}
                </span>
                <span className="shrink-0 tabular-nums text-ink-soft">
                  <span className="font-semibold text-ink">{r.count.toLocaleString("en")}</span>
                  {total > 0 ? ` · ${pct.toFixed(1)}%` : ""}
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-sunken">
                <div
                  className={`h-2 rounded-full ${BAR_TONES[r.tone]}`}
                  style={{ width: `${Math.max(pct, r.count ? 0.8 : 0)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- histogram

/** Counts per bin as vertical bars; bars start at zero, each labelled with its count. */
export function Histogram({
  bins,
  height = 200,
  caption,
  highlight,
}: {
  bins: { label: string; count: number }[];
  height?: number;
  caption: string;
  /** Index of the bin holding the median, drawn in gold. */
  highlight?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(...bins.map((b) => b.count), 1);
  const left = 8;
  const plotW = Math.max(width - left - 8, 1);
  const plotH = height - 26 - 20;
  const slot = plotW / Math.max(bins.length, 1);
  const barW = Math.min(slot * 0.72, 64);
  const cx = (i: number) => left + slot * (i + 0.5);
  const y = (v: number) => 20 + (1 - v / max) * plotH;
  return (
    <div ref={ref}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={caption}>
          <line x1={left} x2={width - 8} y1={y(0)} y2={y(0)} className="stroke-ink-faint" />
          {bins.map((b, i) => (
            <g key={b.label}>
              <rect
                x={cx(i) - barW / 2}
                y={y(b.count)}
                width={barW}
                height={y(0) - y(b.count)}
                rx={2}
                className={i === highlight ? "fill-gold" : "fill-navy"}
              />
              <text
                x={cx(i)}
                y={y(b.count) - 6}
                textAnchor="middle"
                className="fill-ink text-[11.5px] font-semibold"
              >
                {b.count.toLocaleString("en")}
              </text>
              <text
                x={cx(i)}
                y={height - 8}
                textAnchor="middle"
                className="fill-ink-soft text-[11px]"
              >
                {b.label}
              </text>
            </g>
          ))}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      <ScreenReaderTable caption={caption} rows={bins.map((b) => [b.label, String(b.count)])} />
    </div>
  );
}
