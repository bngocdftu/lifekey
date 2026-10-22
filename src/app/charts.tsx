"use client";

import type { ReactNode } from "react";
import { fmtTime } from "@/lib/client/api";

// Small charts drawn with plain HTML/SVG and the theme tokens, no chart library. Every chart keeps
// one scale, recessive grid lines, thin marks and a native tooltip (<title> or title=) per mark.

export interface Seg {
  key: string;
  label: string;
  value: number;
  color: string;
  hatched?: boolean;
}

/** One row of proportional segments, 2px apart, with a legend that carries the counts. */
export function SegBar({ parts, label }: { parts: Seg[]; label: string }) {
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div className="seg">
      <div className="seg-bar" role="img" aria-label={`${label}: ${shown.map((p) => `${p.label} ${p.value}`).join(", ")}`}>
        {shown.map((p) => (
          <span key={p.key} title={`${p.label}: ${p.value}`} className={p.hatched ? "hatched" : undefined}
            style={{ flexGrow: p.value, ["--c" as string]: p.color }} />
        ))}
      </div>
      <ul className="seg-legend">
        {shown.map((p) => (
          <li key={p.key}><i className={p.hatched ? "hatched" : undefined} style={{ ["--c" as string]: p.color }} />{p.label}<b>{p.value}</b></li>
        ))}
      </ul>
    </div>
  );
}

export interface MatrixRow {
  id: string;
  label: string;
  sub: string;
  color: string;
  tags: string[];
}

const SITUATIONS: { key: string; label: string }[] = [
  { key: "trauma", label: "Trauma" },
  { key: "surgery", label: "Surgery" },
  { key: "bleeding", label: "Bleeding" },
  { key: "imaging", label: "Imaging" },
  { key: "sedation", label: "Sedation" },
];

/** Which alert matters in which situation. A tag of "all" fills the whole row. */
export function SituationMatrix({ rows }: { rows: MatrixRow[] }) {
  const hits = (r: MatrixRow, s: string) => r.tags.includes(s) || r.tags.includes("all");
  const totals = SITUATIONS.map((s) => rows.filter((r) => hits(r, s.key)).length);
  const top = Math.max(...totals);
  return (
    <div className="table-wrap">
      <table className="matrix">
        <thead>
          <tr>
            <th scope="col">Alert</th>
            {SITUATIONS.map((s) => <th key={s.key} scope="col">{s.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th scope="row"><b>{r.label}</b><span>{r.sub}</span></th>
              {SITUATIONS.map((s) => (
                <td key={s.key}>
                  {hits(r, s.key)
                    ? <span className="cell on" style={{ ["--c" as string]: r.color }} title={`${r.label}: check before ${s.label.toLowerCase()}`}><span className="sr-only">Yes</span></span>
                    : <span className="cell" aria-hidden="true" />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Alerts to check</th>
            {totals.map((t, i) => (
              <td key={SITUATIONS[i].key}>
                <span className={`count${t === top ? " top" : ""}`}>{t}</span>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** How much of a grant's lifetime is left. */
export function TimeLeft({ issuedAt, expiresAt }: { issuedAt: number; expiresAt: number }) {
  const now = Math.floor(Date.now() / 1000);
  const total = Math.max(1, expiresAt - issuedAt);
  const left = Math.max(0, expiresAt - now);
  const ratio = left / total;
  const mins = (s: number) => Math.round(s / 60);
  return (
    <div className="timeleft">
      <div className="tl-text">
        <span className="label">Time left</span>
        <span className="num"><b>{left ? `${mins(left)} min` : "Expired"}</b><span className="faint"> / {mins(total)} min</span></span>
      </div>
      <div className="tl-bar" role="progressbar" aria-label="Time left on the read grant" aria-valuemin={0} aria-valuemax={mins(total)} aria-valuenow={mins(left)}>
        <span className={ratio < 0.25 ? "low" : undefined} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

/** A round number at or above n, so the top grid line names a value the chart can reach. */
function niceMax(n: number) {
  if (n <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= n) ?? n;
}

/** Share of a whole, with a figure in the middle. Segments sit 2px apart. */
export function Donut({ parts, center, sub, size = 132, label }: { parts: Seg[]; center: ReactNode; sub?: string; size?: number; label: string }) {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((s, p) => s + p.value, 0);
  const stroke = 14, r = (size - stroke) / 2, c = 2 * Math.PI * r, gap = shown.length > 1 ? 3 : 0;
  let acc = 0;
  return (
    <div className="donut">
      <div className="donut-fig" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${label}: ${shown.map((p) => `${p.label} ${p.value}`).join(", ") || "no data"}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--well)" strokeWidth={stroke} />
          {total > 0 && shown.map((p) => {
            const len = (p.value / total) * c;
            const el = (
              <circle key={p.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={stroke}
                strokeDasharray={`${Math.max(0.5, len - gap)} ${c}`} strokeDashoffset={-acc} transform={`rotate(-90 ${size / 2} ${size / 2})`}>
                <title>{`${p.label}: ${p.value} (${Math.round((p.value / total) * 100)}%)`}</title>
              </circle>
            );
            acc += len;
            return el;
          })}
        </svg>
        <div className="donut-center"><b>{center}</b>{sub && <span>{sub}</span>}</div>
      </div>
      <ul className="seg-legend col">
        {shown.map((p) => <li key={p.key}><i style={{ ["--c" as string]: p.color }} />{p.label}<b>{p.value}</b></li>)}
      </ul>
    </div>
  );
}

/** Ranked horizontal bars; the value is printed at the end of each bar. */
export function BarList({ rows, unit = "" }: { rows: { key: string; label: ReactNode; value: number; color?: string; note?: string }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="barlist">
      {rows.map((r) => (
        <li key={r.key} title={`${r.note ?? ""}${r.note ? ": " : ""}${r.value.toLocaleString("en-GB")}${unit}`}>
          <span className="bl-label">{r.label}</span>
          <span className="bl-track"><span style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? "var(--accent)" }} /></span>
          <span className="bl-val num">{r.value.toLocaleString("en-GB")}{unit}</span>
        </li>
      ))}
    </ul>
  );
}

/** One meter: how far along something is, against its target. */
export function Meter({ value, total, label, tone = "var(--accent)" }: { value: number; total: number; label: string; tone?: string }) {
  const ratio = total ? Math.min(1, value / total) : 0;
  return (
    <div className="meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={value}>
      <span style={{ width: `${ratio * 100}%`, background: tone }} />
    </div>
  );
}

export interface Bucket {
  label: string;
  tip: string;
  values: { key: string; value: number; color: string }[];
}

/** Hourly buckets (wider when the entries span more than a day), oldest first, split ok / refused. */
export function timeBuckets(entries: { at: number; outcome: string }[]): Bucket[] {
  if (!entries.length) return [];
  const ats = entries.map((e) => e.at);
  const size = Math.max(3600, Math.ceil((Math.max(...ats) - Math.min(...ats) + 1) / 24 / 3600) * 3600);
  const first = Math.floor(Math.min(...ats) / size) * size;
  const n = Math.floor((Math.max(...ats) - first) / size) + 1;
  return Array.from({ length: n }, (_, i) => {
    const from = first + i * size;
    const inside = entries.filter((e) => e.at >= from && e.at < from + size);
    const bad = inside.filter((e) => e.outcome === "denied" || e.outcome === "error").length;
    const ok = inside.length - bad;
    return {
      label: new Date(from * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      tip: `${fmtTime(from)}: ${ok} succeeded, ${bad} denied`,
      values: [{ key: "ok", value: ok, color: "var(--positive)" }, { key: "bad", value: bad, color: "var(--negative)" }],
    };
  });
}

/** Stacked columns over time, bottom-anchored, with a 2px surface gap between segments. */
export function Columns({ buckets, height = 170, label, every = 1 }: { buckets: Bucket[]; height?: number; label: string; every?: number }) {
  const W = 640, L = 30, R = 6, T = 10, B = 24;
  const totals = buckets.map((b) => b.values.reduce((s, v) => s + v.value, 0));
  const max = niceMax(Math.max(0, ...totals));
  const y = (v: number) => height - B - ((height - B - T) * v) / max;
  const step = (W - L - R) / Math.max(1, buckets.length);
  const bw = Math.max(4, Math.min(28, step - 4));
  const ticks = [0, max / 2, max];
  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className={t ? "grid" : "axis"} />
          <text x={L - 6} y={y(t) + 4} textAnchor="end">{t}</text>
        </g>
      ))}
      {buckets.map((b, i) => {
        const x = L + step * i + (step - bw) / 2;
        let base = 0;
        return (
          <g key={i} className="col">
            <rect x={L + step * i} y={T} width={step} height={height - B - T} fill="transparent" />
            {b.values.filter((v) => v.value > 0).map((v, j, arr) => {
              const top = y(base + v.value), bottom = y(base);
              base += v.value;
              const h = Math.max(1, bottom - top - (j > 0 ? 2 : 0));
              return <rect key={v.key} x={x} y={top} width={bw} height={h} rx={j === arr.length - 1 ? 3 : 0} fill={v.color} />;
            })}
            <title>{b.tip}</title>
            {i % every === 0 && <text x={x + bw / 2} y={height - 6} textAnchor="middle">{b.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

/** A single series over time: 2px line, soft area, emphasised last point. */
export function AreaChart({ points, labels, label, height = 120 }: { points: number[]; labels: string[]; label: string; height?: number }) {
  const W = 640, L = 6, R = 10, T = 12, B = 22;
  const max = niceMax(Math.max(0, ...points));
  const x = (i: number) => L + ((W - L - R) * i) / Math.max(1, points.length - 1);
  const y = (v: number) => height - B - ((height - B - T) * v) / max;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const last = points.length - 1;
  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="axis" />
      <line x1={L} x2={W - R} y1={y(max)} y2={y(max)} className="grid" />
      <text x={W - R} y={y(max) - 3} textAnchor="end">{max}</text>
      <path d={`${line} L${x(last)},${y(0)} L${x(0)},${y(0)} Z`} fill="var(--accent)" opacity="0.14" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
      {points.map((p, i) => (
        <rect key={i} x={x(i) - (W - L - R) / points.length / 2} y={T} width={(W - L - R) / points.length} height={height - B - T} fill="transparent">
          <title>{`${labels[i]}: ${p} events`}</title>
        </rect>
      ))}
      <circle cx={x(last)} cy={y(points[last] ?? 0)} r="4.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
      <text x={L} y={height - 6}>{labels[0]}</text>
      <text x={W - R} y={height - 6} textAnchor="end">{labels[last]}</text>
    </svg>
  );
}

/** Events on one time axis, labels staggered so earlier events sit lower and never collide. */
export function Timeline({ start, end, now, marks, label }: {
  start: number; end: number; now?: number; label: string;
  marks: { at: number; text: string; tone?: string }[];
}) {
  const W = 640, L = 12, R = 12, barY = 26, rows = marks.length;
  const H = barY + 26 + rows * 22;
  const x = (t: number) => L + ((W - L - R) * (Math.min(Math.max(t, start), end) - start)) / Math.max(1, end - start);
  const sorted = [...marks].sort((a, b) => a.at - b.at);
  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <rect x={L} y={barY} width={W - L - R} height={8} rx={4} fill="var(--well)" />
      {now !== undefined && <rect x={L} y={barY} width={Math.max(0, x(now) - L)} height={8} rx={4} fill="var(--warning)" opacity="0.85"><title>Elapsed</title></rect>}
      {now !== undefined && <text x={x(now)} y={barY - 8} textAnchor={x(now) > W - 80 ? "end" : "middle"} className="ink">Now</text>}
      {sorted.map((m, i) => {
        const row = rows - 1 - i, ty = barY + 30 + row * 22, mx = x(m.at), right = mx > W * 0.62;
        return (
          <g key={i}>
            <line x1={mx} x2={mx} y1={barY + 8} y2={ty - 4} stroke="var(--label)" strokeDasharray="2 2" />
            <circle cx={mx} cy={barY + 4} r={5} fill={m.tone ?? "var(--text)"} stroke="var(--surface)" strokeWidth="2" />
            <text x={right ? mx - 6 : mx + 6} y={ty} textAnchor={right ? "end" : "start"} className="ink">{m.text}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Rows against columns; a filled cell means the pair applies. */
export function DotMatrix({ rows, cols, cell }: {
  rows: { key: string; label: ReactNode }[];
  cols: { key: string; label: string }[];
  cell: (row: string, col: string) => { color: string; tip: string; hollow?: boolean } | null;
}) {
  return (
    <div className="table-wrap">
      <table className="matrix">
        <thead><tr><th scope="col" />{cols.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              {cols.map((c) => {
                const v = cell(r.key, c.key);
                return (
                  <td key={c.key}>
                    {v ? <span className={`cell on${v.hollow ? " hollow" : ""}`} style={{ ["--c" as string]: v.color }} title={v.tip}><span className="sr-only">{v.tip}</span></span>
                      : <span className="cell" aria-hidden="true" />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The audit log as linked blocks: each block carries the hash of the one before it. */
export function HashChain({ items, brokenAt }: { items: { seq: number; hash: string; ok: boolean; tip: string }[]; brokenAt: number | null }) {
  return (
    <ol className="chain" aria-label="Access log hash chain">
      {items.map((it) => {
        const broken = brokenAt !== null && it.seq >= brokenAt;
        return (
          <li key={it.seq} className={broken ? "broken" : it.ok ? "" : "denied"} title={it.tip}>
            <b className="num">#{it.seq}</b>
            <span className="mono">{it.hash ? it.hash.slice(0, 6) : "······"}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Ordinal speed: which of the steps something reaches, drawn as a track with a dot. */
export function StepTrack({ steps, at }: { steps: string[]; at: number }) {
  const pct = steps.length > 1 ? (at / (steps.length - 1)) * 100 : 0;
  return (
    <div className="steptrack" role="img" aria-label={`${steps[at]} (${at + 1}/${steps.length})`}>
      <div className="st-line"><span style={{ width: `${pct}%` }} /><i style={{ left: `${pct}%` }} /></div>
      <div className="st-ticks">{steps.map((s, i) => <span key={s} className={i === at ? "on" : undefined}>{s}</span>)}</div>
    </div>
  );
}
