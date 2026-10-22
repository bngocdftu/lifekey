"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useCallback, useEffect, useState } from "react";
import { decryptRecord, fmtTime, networkReason, useApi } from "@/lib/client/api";
import type { AuditEntry } from "@/lib/lifekey/audit";
import type { RecordMeta } from "@/lib/lifekey/catalogue";
import { TIER0_FIELDS, TIER0_MAX_LENGTH, type PatientConsent, type Tier0Field } from "@/lib/lifekey/consent";
import { displayName } from "../AppShell";
import { BarList, Columns, Donut, Meter, SegBar, Timeline, TimeLeft, timeBuckets } from "../charts";
import { STATUS_TEXT } from "../GrantCard";
import { Icon, IconTile, PatientQR } from "../ui";

// The patient's own screen: what they agreed to, who opened which record, and what is open now.
// Nothing here decrypts a record: the patient holds no policy, only metadata about their records.

interface MyRecord {
  patient: { id: string; publicId: string; displayName: string };
  consent: PatientConsent | null;
  records: (RecordMeta & { stored: boolean; ciphertext: string | null })[];
  requests: { id: string; purpose: "clinical" | "patient-self"; recordId: string; doctorUsername: string; reason: string; createdAt: number; expiresAt: number; status: string; clarifications: { by: string; text: string; at: number }[] }[];
  breakGlass: { id: string; recordId: string; doctorUsername: string; reason: string; declaredAt: number; reviewDueAt: number; notified: string[]; status: string; overdue: boolean; reviews: { reviewer: string; decision: string; note: string; at?: number }[]; patientObjection?: { note: string; at: number } }[];
  standing: { name: string; kind: string; recordId: string; subject: string; access: string; expiry?: number; status: string }[];
  audit: AuditEntry[];
}

const FIELD_TEXT: Record<Tier0Field, string> = {
  bloodType: "Blood type",
  allergies: "Allergies",
  medications: "Current medications",
  implants: "Implants",
  emergencyContact: "Emergency contact",
};
// The patient's log in plain words.
const ACTION_TEXT: Record<string, string> = {
  "record.decrypt": "read",
  "record.write": "entered",
  "patient.lookup": "scanned your QR code",
  "request.create": "requested access to",
  "request.status": "updated a request for",
  "break-glass.declare": "broke the glass on",
  "break-glass.review": "reviewed a break-glass on",
  "grant.file": "sent a grant to approvers for",
  "grant.signed": "got a grant signed for",
  "consent.sign": "signed consent",
  "request.clarify": "asked about a request for",
  "break-glass.objection": "objected to a break-glass on",
};
const SUBJECT_TEXT: Record<string, string> = {
  "lifekey-clinician": "Every verified clinician",
  "er-attending": "On-duty ER doctors",
  "lifekey-recorder": "Records office",
};
const KIND_TEXT: Record<string, string> = {
  "tier1-standing": "can read",
  "break-glass-standing": "can break glass on",
  "recorder-write": "can write (not read)",
};
const BG_STATUS: Record<string, { text: string; cls: string }> = {
  AWAITING_REVIEW: { text: "Awaiting review", cls: "warn" },
  JUSTIFIED: { text: "Justified", cls: "pos" },
  FLAGGED: { text: "Flagged", cls: "neg" },
};
const STANDING_SECONDS = 30 * 24 * 3600;
const actor = (u: string) => (u === "lifekey-server" ? "Server" : u === "patient-alice" ? "You" : displayName(u));

export default function MyRecordPage() {
  const { authenticated, login } = useTideCloak();
  const api = useApi();
  const [data, setData] = useState<MyRecord | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bg, setBg] = useState<string[]>([]);
  const [card, setCard] = useState<Partial<Record<Tier0Field, { show: boolean; value: string }>>>({});
  const [saved, setSaved] = useState<{ version: number; stillSigned: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [askRecord, setAskRecord] = useState("T1-PAT-001");
  const [askReason, setAskReason] = useState("");
  const [opened, setOpened] = useState<Record<string, { text?: string; error?: string }>>({});
  const [objection, setObjection] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const d = await api<MyRecord>("/api/my-record");
      setData(d);
      setErr(null);
      setBg(d.consent?.breakGlass ?? d.records.filter((r) => r.tier === 2 && r.breakGlassEligible).map((r) => r.id));
      setCard(Object.fromEntries(TIER0_FIELDS.map((f) => [f, { show: !!d.consent?.tier0[f], value: d.consent?.tier0[f] ?? "" }])));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [api]);

  useEffect(() => {
    if (authenticated) load();
  }, [authenticated, load]);

  async function sign() {
    setBusy(true);
    setSaved(null);
    try {
      const tier0 = Object.fromEntries(TIER0_FIELDS.filter((f) => card[f]?.show && card[f]?.value.trim()).map((f) => [f, card[f]!.value]));
      const r = await api<{ consent: PatientConsent; stillSigned: string[] }>("/api/consent", { method: "POST", body: { breakGlass: bg, tier0 } });
      setSaved({ version: r.consent.version, stillSigned: r.stillSigned });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function askToRead(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/my-record/requests", { method: "POST", body: { recordId: askRecord, reason: askReason } });
      setAskReason("");
      await load();
    } catch (x) {
      const b = (x as { body?: { errors?: string[] } }).body;
      setErr(b?.errors?.join("; ") ?? (x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function readOwn(recordId: string, requestId: string) {
    const ct = data?.records.find((r) => r.id === recordId)?.ciphertext;
    if (!ct) return setOpened((o) => ({ ...o, [recordId]: { error: "This record has not been entered yet." } }));
    try {
      const { policy } = await api<{ policy: string }>(`/api/policies?purpose=request&record=${recordId}&request=${requestId}`);
      const text = await decryptRecord(ct, recordId, policy);
      setOpened((o) => ({ ...o, [recordId]: { text: JSON.stringify(JSON.parse(text), null, 2) } }));
    } catch (x) {
      setOpened((o) => ({ ...o, [recordId]: { error: networkReason(x) } }));
    }
  }

  async function object(eventId: string) {
    setBusy(true);
    try {
      await api("/api/my-record/objections", { method: "POST", body: { eventId, note: objection[eventId] ?? "" } });
      await load();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!authenticated) {
    return (
      <>
        <div className="title-row"><div><h1>My record</h1><p className="sub">Sign in with a patient account.</p></div></div>
        <button className="btn primary" onClick={login}>Sign in with Tide</button>
      </>
    );
  }
  if (err && !data) return <p className="notice neg">{err === "patients only" ? "This page is for patient accounts." : err}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const now = Math.floor(Date.now() / 1000);
  const title = (id: string) => data.records.find((r) => r.id === id)?.title ?? id;
  const reads = data.audit.filter((e) => e.action === "record.decrypt");
  const readsOk = reads.filter((e) => e.outcome === "ok");
  const byPerson = Object.entries(readsOk.reduce<Record<string, number>>((m, e) => ({ ...m, [e.actor]: (m[e.actor] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const byRecord = data.records.map((r, i) => ({
    key: r.id, label: r.title, value: readsOk.filter((e) => e.resource === r.id).length,
    color: ["var(--pink)", "var(--teal)", "var(--orange)", "var(--grey)"][i % 4],
  }));
  const touching = data.audit.filter((e) => e.actor !== "lifekey-server" && !e.action.startsWith("policy."));
  const activeReqs = data.requests.filter((r) => r.purpose !== "patient-self" && r.status === "AUTHORIZED" && r.expiresAt > now);
  const mine = data.requests.filter((r) => r.purpose === "patient-self");
  const signedStanding = data.standing.filter((s) => s.status === "SIGNED" && s.access === "read");
  const openBg = data.breakGlass.filter((e) => e.status === "AWAITING_REVIEW");
  const changed = !!data.consent && (JSON.stringify([...bg].sort()) !== JSON.stringify([...data.consent.breakGlass].sort())
    || TIER0_FIELDS.some((f) => (card[f]?.show ? card[f]!.value.trim() : "") !== (data.consent!.tier0[f] ?? "")));

  return (
    <>
      <section className="panel" style={{ marginBottom: "var(--gap)" }} aria-label="Patient">
        <div className="head" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div className="head">
            <span className="avatar" style={{ width: 56, height: 56, fontSize: 18, background: "var(--green-soft)", color: "var(--green)" }}>AN</span>
            <div>
              <span className="label">My record</span>
              <h1 style={{ fontSize: 24, lineHeight: "30px", fontWeight: 700, letterSpacing: "-0.02em" }}>{data.patient.displayName}</h1>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                <span className="pill">{data.patient.id}</span>
                {data.consent
                  ? <span className="pill pos">Consent version {data.consent.version} · {fmtTime(data.consent.signedAt)}</span>
                  : <span className="pill warn">Consent not signed</span>}
              </div>
            </div>
          </div>
          <button className="btn icon" onClick={load} aria-label="Reload"><Icon name="refresh" /></button>
        </div>
      </section>

      {err && <p className="notice neg" style={{ marginBottom: "var(--gap)" }}>{err}</p>}

      <div className="kpis summary" style={{ marginBottom: "var(--gap)" }}>
        <div className="kpi">
          <span className="kpi-label">Reads of your record</span>
          <div className="kpi-value">{readsOk.length}<small>{readsOk.length === 1 ? "read" : "reads"} · {reads.length - readsOk.length} blocked</small></div>
          <div className="kpi-chart">
            <SegBar label="Reads" parts={[
              { key: "ok", label: "Readable", value: readsOk.length, color: "var(--positive)" },
              { key: "bad", label: "Blocked", value: reads.length - readsOk.length, color: "var(--negative)" },
            ]} />
          </div>
        </div>
        <div className="kpi">
          <span className="kpi-label">Open grants</span>
          <div className="kpi-value">{activeReqs.length + signedStanding.length}<small>{activeReqs.length + signedStanding.length === 1 ? "read grant" : "read grants"}</small></div>
          <div className="kpi-chart">
            <SegBar label="Open grants" parts={[
              { key: "standing", label: "By role", value: signedStanding.length, color: "var(--teal)" },
              { key: "jit", label: "For one doctor", value: activeReqs.length, color: "var(--orange)" },
            ]} />
          </div>
        </div>
        <div className="kpi">
          <span className="kpi-label">Break-glass</span>
          <div className="kpi-value">{data.breakGlass.length}<small>{data.breakGlass.length === 1 ? "time" : "times"} · {openBg.length} awaiting review</small></div>
          <div className="kpi-chart">
            <SegBar label="Break-glass" parts={Object.entries(BG_STATUS).map(([k, v]) => ({
              key: k, label: v.text, value: data.breakGlass.filter((e) => e.status === k).length,
              color: k === "JUSTIFIED" ? "var(--positive)" : k === "FLAGGED" ? "var(--negative)" : "var(--warning)",
            }))} />
          </div>
        </div>
      </div>

      <div className="chart-grid">
        <section className="panel span-8" aria-labelledby="act-h">
          <header>
            <h2 id="act-h">Who did what with your record</h2>
            <span className="legend-inline"><span><i style={{ background: "var(--positive)" }} />Succeeded</span><span><i style={{ background: "var(--negative)" }} />Denied</span></span>
          </header>
          {touching.length ? <Columns buckets={timeBuckets(touching)} label="Activity on your record by hour" every={2} /> : <p className="muted">No one has opened your record yet.</p>}
        </section>
        <section className="panel span-4" aria-labelledby="rec-h">
          <header><h2 id="rec-h">Which records were read</h2></header>
          <Donut label="Reads by record" size={116} parts={byRecord} center={readsOk.length} sub="reads" />
          <h3 id="who-h" className="small faint" style={{ margin: "18px 0 10px", fontWeight: 500 }}>Who read</h3>
          {byPerson.length ? <BarList rows={byPerson.map(([u, n]) => ({ key: u, label: actor(u), value: n }))} /> : <p className="small muted">No reads yet.</p>}
        </section>
        <section className="panel span-12" aria-labelledby="log-h">
          <header><h2 id="log-h">Recent</h2><span className="meta">{touching.length} events</span></header>
          <div className="rows">
            {touching.slice(0, 7).map((e) => (
              <div key={e.seq} className="row">
                <span className="grow">
                  <b style={{ fontWeight: 600 }}>{actor(e.actor)}</b> {ACTION_TEXT[e.action] ?? e.action} {e.resource === data.patient.id ? "" : <span className="mono">{title(e.resource)}</span>}
                  <span className="line2">{fmtTime(e.at)}{e.detail ? ` · ${e.detail.replace(/^client-reported: /, "")}` : ""}</span>
                </span>
                <span className={`pill ${e.outcome === "ok" ? "pos" : e.outcome === "info" ? "" : "neg"}`}>{e.outcome === "ok" ? "Succeeded" : e.outcome === "info" ? "Noted" : "Denied"}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {data.breakGlass.length > 0 && (
        <section className="sec" style={{ marginBottom: "var(--gap)" }} aria-labelledby="bg-h">
          <div className="title-row" style={{ marginBottom: 12, alignItems: "baseline" }}>
            <h2 id="bg-h" style={{ fontSize: 17, fontWeight: 600 }}>Break-glass alerts</h2>
            <span className="stamp">You are told every time someone breaks the glass</span>
          </div>
          <div className="stack">
            {data.breakGlass.map((e) => (
              <div key={e.id} className="panel">
                <header>
                  <div className="head">
                    <IconTile name="bolt" tone="orange" round />
                    <div><span className="label">{displayName(e.doctorUsername)} opened at {fmtTime(e.declaredAt)}:</span><span className="value">{title(e.recordId)}</span></div>
                  </div>
                  <span className={`pill ${BG_STATUS[e.status]?.cls ?? ""}`}>{BG_STATUS[e.status]?.text ?? e.status}{e.overdue ? " · overdue" : ""}</span>
                </header>
                <p className="muted" style={{ marginBottom: 12 }}>Reason: {e.reason}</p>
                <div style={{ maxWidth: 720 }}><Timeline label={`Timeline of ${e.id}`} start={e.declaredAt} end={e.reviewDueAt} now={e.status === "AWAITING_REVIEW" ? now : undefined}
                  marks={[
                    { at: e.declaredAt, text: `${displayName(e.doctorUsername)} opened the record`, tone: "var(--orange)" },
                    ...e.reviews.filter((r) => r.at).map((r) => ({ at: r.at!, text: `${displayName(r.reviewer)}: ${r.decision === "justified" ? "justified" : "not justified"}`, tone: r.decision === "justified" ? "var(--positive)" : "var(--negative)" })),
                    { at: e.reviewDueAt, text: "Review due (72 h)", tone: "var(--label)" },
                  ]} /></div>
                <p className="small faint" style={{ marginTop: 8 }}>{e.reviews.length}/2 reviewers done. One "not justified" vote flags the event and proposes revoking that doctor's on-duty access.</p>
                {e.patientObjection ? (
                  <p className="notice warn" style={{ marginTop: 12 }}>You said this break-glass was not needed ({fmtTime(e.patientObjection.at)}): {e.patientObjection.note}. The reviewers can see this.</p>
                ) : e.status === "AWAITING_REVIEW" && (
                  <div className="field" style={{ marginTop: 12 }}>
                    <label htmlFor={`obj-${e.id}`}>Was this break-glass unnecessary?</label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <input id={`obj-${e.id}`} className="input" style={{ flex: "1 1 260px" }} placeholder="E.g. I was awake and could list my own medications"
                        value={objection[e.id] ?? ""} onChange={(x) => setObjection((o) => ({ ...o, [e.id]: x.target.value }))} />
                      <button className="btn" disabled={busy} onClick={() => object(e.id)}>Tell the reviewers</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="chart-grid">
        <section className="panel span-6" aria-labelledby="open-h">
          <header><h2 id="open-h">Who can read your record now</h2></header>
          <div className="stack" style={{ gap: 14 }}>
            {activeReqs.map((r) => (
              <div key={r.id} className="inset" style={{ display: "grid", gap: 10 }}>
                <span><b style={{ fontWeight: 600 }}>{displayName(r.doctorUsername)}</b> can read <b style={{ fontWeight: 600 }}>{title(r.recordId)}</b><span className="small muted" style={{ display: "block" }}>{r.reason}</span></span>
                <TimeLeft issuedAt={r.createdAt} expiresAt={r.expiresAt} />
              </div>
            ))}
            {signedStanding.map((s) => (
              <div key={s.name} style={{ display: "grid", gap: 6 }}>
                <span className="small" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span>{SUBJECT_TEXT[s.subject] ?? s.subject} {KIND_TEXT[s.kind] ?? ""} <b style={{ fontWeight: 600 }}>{title(s.recordId)}</b></span>
                  <span className="faint num">until {fmtTime(s.expiry)}</span>
                </span>
                {s.expiry && <Meter value={Math.max(0, s.expiry - now)} total={STANDING_SECONDS} label={`Time left on the grant for ${s.recordId}`} />}
              </div>
            ))}
            {data.requests.filter((r) => r.purpose !== "patient-self" && r.status === "PENDING_APPROVAL").map((r) => (
              <p key={r.id} className="small"><span className="pill warn">{STATUS_TEXT[r.status]}</span> {displayName(r.doctorUsername)} asked to read {title(r.recordId)}</p>
            ))}
            {!activeReqs.length && !signedStanding.length && <p className="small muted">No one has a read grant on your record.</p>}
            <p className="small faint">The bar under each role grant shows time left of its 30 days. When it expires, approvers must sign again.</p>
          </div>
        </section>

        <section className="panel span-6" aria-labelledby="card-h">
          <header><h2 id="card-h">Emergency card</h2><span className="meta">Anyone holding the card can read it</span></header>
          <div className="emergency-card">
            <div className="ec-head"><b>LifeKey · Emergency card</b><span>{data.patient.displayName}</span></div>
            <dl>
              {TIER0_FIELDS.filter((f) => card[f]?.show && card[f]?.value.trim()).map((f) => (
                <div key={f}><dt>{FIELD_TEXT[f]}</dt><dd>{card[f]!.value}</dd></div>
              ))}
            </dl>
            {!TIER0_FIELDS.some((f) => card[f]?.show && card[f]?.value.trim()) && <p className="small">The card shows nothing but the QR code yet.</p>}
            <PatientQR publicId={data.patient.publicId} />
          </div>
          <p className="small faint" style={{ marginTop: 10 }}>The card is not encrypted, like Medical ID on a phone. The QR code only links to the record; it holds no medical data.</p>
        </section>
      </div>

      <section className="panel" style={{ marginBottom: "var(--gap)" }} aria-labelledby="ask-h">
        <header><h2 id="ask-h">Ask to read my record</h2><span className="meta">Needs 2 approver signatures · readable for 2 h</span></header>
        <div className="consent-grid">
          <form onSubmit={askToRead} className="stack" style={{ gap: 12 }}>
            <div className="field">
              <label htmlFor="ask-record">Record</label>
              <select id="ask-record" className="input" value={askRecord} onChange={(e) => setAskRecord(e.target.value)}>
                {data.records.map((r) => <option key={r.id} value={r.id}>{r.title} ({r.id})</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ask-reason">Reason</label>
              <textarea id="ask-reason" className="input" rows={2} value={askReason} onChange={(e) => setAskReason(e.target.value)} placeholder="E.g. I want to check my medication list before a follow-up visit" />
            </div>
            <button className="btn primary" type="submit" disabled={busy || askReason.trim().length < 10}>Send request</button>
            <p className="small faint">The read grant names only you and this one record. The Tide network checks that on every open, just as for a doctor's request.</p>
          </form>
          <div className="rows">
            {mine.map((r) => (
              <div key={r.id} className="row" style={{ display: "grid", gap: 8 }}>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span><b style={{ fontWeight: 600 }}>{title(r.recordId)}</b><span className="line2">{r.id} · {fmtTime(r.createdAt)} · {r.reason}</span></span>
                  <span className={`pill ${r.status === "AUTHORIZED" ? "pos" : r.status === "PENDING_APPROVAL" ? "warn" : "neg"}`}>{STATUS_TEXT[r.status] ?? r.status}</span>
                </span>
                {r.clarifications.map((c, i) => <p key={i} className="notice small">{displayName(c.by)} asked: {c.text}</p>)}
                {r.status === "AUTHORIZED" && (
                  <>
                    <TimeLeft issuedAt={r.createdAt} expiresAt={r.expiresAt} />
                    <button className="btn soft" onClick={() => readOwn(r.recordId, r.id)}>Read record</button>
                  </>
                )}
                {opened[r.recordId]?.text && <pre className="record">{opened[r.recordId].text}</pre>}
                {opened[r.recordId]?.error && <p className="notice neg small">{opened[r.recordId].error}</p>}
              </div>
            ))}
            {!mine.length && <p className="small muted">You have not asked to read any record yet.</p>}
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="consent-h">
        <header>
          <h2 id="consent-h">My consent</h2>
          <span className="meta">{data.consent ? `Version ${data.consent.version}, signed ${fmtTime(data.consent.signedAt)}` : "Not signed"}</span>
        </header>
        <div className="consent-grid">
          <fieldset>
            <legend>Which records an on-duty ER doctor can break glass on</legend>
            <ul className="rows">
              {data.records.map((r) => (
                <li key={r.id} className="row">
                  <IconTile name={r.tier === 3 ? "lock" : r.tier === 1 ? "heart" : "file"} tone={r.tier === 3 ? "grey" : r.tier === 1 ? "pink" : "teal"} sm />
                  <span className="grow">{r.title}<span className="line2">{r.id} · {r.tier === 1 ? "Every verified clinician can always read" : r.tier === 3 ? "Never opened in an emergency" : "Normally needs 2 approvers"}</span></span>
                  {r.tier === 2 ? (
                    <label className="switch">
                      <input type="checkbox" id={`bg-${r.id}`} checked={bg.includes(r.id)} onChange={(e) => setBg((x) => e.target.checked ? [...x, r.id] : x.filter((y) => y !== r.id))} />
                      <span>Allow break-glass</span>
                    </label>
                  ) : <span className="small faint">{r.tier === 1 ? "Always shown" : "Locked"}</span>}
                </li>
              ))}
            </ul>
          </fieldset>
          <fieldset>
            <legend>What the emergency card shows</legend>
            <div className="stack" style={{ gap: 10 }}>
              {TIER0_FIELDS.map((f) => (
                <div key={f} className="card-field">
                  <label className="switch">
                    <input type="checkbox" id={`show-${f}`} checked={!!card[f]?.show} onChange={(e) => setCard((c) => ({ ...c, [f]: { value: c[f]?.value ?? "", show: e.target.checked } }))} />
                    <span>{FIELD_TEXT[f]}</span>
                  </label>
                  <input className="input" id={`val-${f}`} aria-label={FIELD_TEXT[f]} maxLength={TIER0_MAX_LENGTH} value={card[f]?.value ?? ""} disabled={!card[f]?.show}
                    onChange={(e) => setCard((c) => ({ ...c, [f]: { show: true, value: e.target.value } }))} />
                </div>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="row" style={{ borderTop: 0, flexWrap: "wrap", gap: 12, paddingBottom: 0 }}>
          <button className="btn primary" disabled={busy || (!!data.consent && !changed)} onClick={sign}>
            {data.consent ? `Sign version ${data.consent.version + 1}` : "Sign consent"}
          </button>
          <span className="small muted">{data.consent && !changed ? "No changes yet." : "You sign with your own Tide account. The records office only files grants you agreed to."}</span>
        </div>
        {saved && (
          <p className="notice acc" style={{ marginTop: 14 }}>
            Signed version {saved.version}.
            {saved.stillSigned.length > 0 && ` LifeKey stops break-glass on ${saved.stillSigned.join(", ")} now. Grants already signed on the Tide network stay valid until they expire, since the network cannot yet revoke single grants.`}
          </p>
        )}
        <p className="small faint" style={{ marginTop: 14 }}>
          LifeKey enforces this consent: it only files the grants you allow, and approvers still sign each one. The Tide network does not check your signature itself yet; that needs a custom Forseti contract deployed by Tide.
        </p>
      </section>
    </>
  );
}
