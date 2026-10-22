"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

// One outline icon set, 1.6px strokes, drawn for LifeKey's own things.
const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const PATHS: Record<string, React.ReactNode> = {
  home: <path {...P} d="M3.5 10 12 3.5 20.5 10v10h-6v-6h-5v6h-6z" />,
  patient: <><circle {...P} cx="12" cy="8" r="3.5" /><path {...P} d="M5 20c.9-3.7 3.7-5.7 7-5.7s6.1 2 7 5.7" /></>,
  check: <><rect {...P} x="3.5" y="3.5" width="17" height="17" rx="5" /><path {...P} d="m8.5 12 2.4 2.4 4.6-5" /></>,
  list: <path {...P} d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
  plus: <><circle {...P} cx="12" cy="12" r="8.5" /><path {...P} d="M12 8v8M8 12h8" /></>,
  shield: <><path {...P} d="M12 3 19 6v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6z" /><path {...P} d="m9 12 2 2 4-4" /></>,
  menu: <path {...P} d="M4 7h16M4 12h16M4 17h16" />,
  close: <path {...P} d="m6 6 12 12M18 6 6 18" />,
  search: <><circle {...P} cx="11" cy="11" r="6.5" /><path {...P} d="m20 20-4.2-4.2" /></>,
  pill: <><rect {...P} x="2.8" y="8.5" width="18.4" height="7" rx="3.5" transform="rotate(-45 12 12)" /><path {...P} d="m9.5 9.5 5 5" /></>,
  allergy: <><path {...P} d="M12 3.5c3 3.6 5.5 6.6 5.5 9.8a5.5 5.5 0 0 1-11 0C6.5 10.1 9 7.1 12 3.5z" /><path {...P} d="M10 14.5a2 2 0 0 0 2 2" /></>,
  heart: <><path {...P} d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.3 4.2 4.2 0 0 1 19.5 10C19.5 15.4 12 20 12 20z" /><path {...P} d="M7.5 12h2.3l1.2-2 2 4 1.2-2h2.3" /></>,
  lock: <><rect {...P} x="5" y="10.5" width="14" height="10" rx="3" /><path {...P} d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  file: <><path {...P} d="M7 3.5h7l4.5 4.5v12.5H7z" /><path {...P} d="M14 3.5V8h4.5M9.5 13h6M9.5 16.5h4" /></>,
  key: <><circle {...P} cx="8" cy="15" r="4" /><path {...P} d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" /></>,
  bolt: <path {...P} d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12z" />,
  clock: <><circle {...P} cx="12" cy="12" r="8.5" /><path {...P} d="M12 7.5V12l3 2" /></>,
  tick: <path {...P} d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path {...P} d="m7 7 10 10M17 7 7 17" />,
  user: <><circle {...P} cx="12" cy="9" r="3.5" /><path {...P} d="M5.5 19.5c1-3 3.5-4.5 6.5-4.5s5.5 1.5 6.5 4.5" /></>,
  refresh: <path {...P} d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4" />,
  back: <path {...P} d="M15 5 8 12l7 7" />,
};

export function Icon({ name, size }: { name: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">{PATHS[name]}</svg>;
}

export function IconTile({ name, tone, round, sm }: { name: string; tone: "pink" | "orange" | "teal" | "green" | "grey"; round?: boolean; sm?: boolean }) {
  return <span className={`ico ${tone}${round ? " round" : ""}${sm ? " sm" : ""}`}><Icon name={name} /></span>;
}

/** A thin progress ring with an icon in the middle, like a match score. */
export function Ring({ value, total, icon, size = 52 }: { value: number; total: number; icon?: string; size?: number }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = total ? Math.min(1, value / total) : 0;
  return (
    <span style={{ position: "relative", width: size, height: size, display: "inline-grid", placeItems: "center", flex: "none" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * ratio} ${c}`} />
      </svg>
      {icon && <span style={{ color: "var(--accent)", width: 20, height: 20, display: "grid" }}><Icon name={icon} /></span>}
    </span>
  );
}

/** The patient's QR: it carries only the opaque public id link, never medical data or a key. */
export function PatientQR({ publicId }: { publicId: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    const url = `${window.location.origin}/emergency/${publicId}`;
    QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#12212a", light: "#0000" } })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [publicId]);
  return (
    <div className="qr">
      <span role="img" aria-label={`Mã QR của bệnh nhân, mã ${publicId}`} dangerouslySetInnerHTML={{ __html: svg }} style={{ width: 128, height: 128, display: "block" }} />
      <span>{publicId}</span>
    </div>
  );
}
