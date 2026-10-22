"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useCallback, useEffect, useState } from "react";
import { fmtTime, useApi } from "@/lib/client/api";
import { approveChangeRequests, denyChangeRequest, type ApproveResult } from "@/lib/client/approve";
import { displayName, initials, personTint } from "../AppShell";
import { Icon, IconTile } from "../ui";
import { GrantCard } from "../GrantCard";
import { Donut, Meter, Timeline } from "../charts";

interface Item {
  policyName: string;
  changeRequestId: string;
  kind: string;
  recordId: string;
  recordTitle?: string;
  tier?: number;
  subject: { type: string; id?: string; username?: string };
  roles: string[];
  expiry?: number;
  request?: { id: string; purpose: "clinical" | "patient-self"; reason: string; alertId?: string; doctorUsername: string; createdAt: number; digest: string; clarifications: { by: string; text: string; at: number }[] };
  blockedReason: string | null;
  changeRequest: { status: string; authorizationCount?: number; threshold?: number; readyToCommit?: boolean; authorizers?: { username: string }[] } | null;
}
interface BG {
  id: string;
  recordId: string;
  doctorUsername: string;
  reason: string;
  declaredAt: number;
  reviewDueAt: number;
  status: string;
  overdue: boolean;
  notified: string[];
  reviews: { reviewer: string; decision: string; note: string; at?: number }[];
  patientObjection?: { note: string; at: number };
}

// Standing grants are written the way an approver would say them.
const KIND_TEXT: Record<string, string> = {
  "emergency-jit": "Request access",
  "tier1-standing": "Verified clinicians read emergency alerts",
  "recorder-write": "Records office may write (not read)",
  "break-glass-standing": "On-duty ER doctors may break glass",
  "patient-self": "Patient asks to read own record",
};
const SUBJECT_TEXT: Record<string, string> = {
  "lifekey-clinician": "Every verified clinician",
  "lifekey-recorder": "Records office",
  "er-attending": "On-duty ER doctors",
};
const NOTIFIED_TEXT: Record<string, string> = {
  patient: "Patient",
  "emergency-contact": "Emergency contact",
  "on-call-approvers": "On-call approvers",
  "privacy-officer": "Privacy office",
};
const BG_STATUS: Record<string, { text: string; cls: string }> = {
  AWAITING_REVIEW: { text: "Awaiting review", cls: "warn" },
  JUSTIFIED: { text: "Justified", cls: "pos" },
  FLAGGED: { text: "Flagged", cls: "neg" },
};

// Short names and colours for the queue donut.
const KIND_LOOK: Record<string, { label: string; color: string }> = {
  "emergency-jit": { label: "Request access", color: "var(--teal)" },
  "tier1-standing": { label: "Read alerts", color: "var(--pink)" },
  "recorder-write": { label: "Write records", color: "var(--green)" },
  "break-glass-standing": { label: "Break-glass", color: "var(--orange)" },
  "patient-self": { label: "Patient request", color: "var(--grey)" },
};

function since(t: number) {
  const m = Math.round((Date.now() / 1000 - t) / 60);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`;
}

export default function ApprovePage() {
  const { authenticated, secureFetch, getValueFromIdToken, login } = useTideCloak();
  const api = useApi();
  const [tab, setTab] = useState<"requests" | "reviews">("requests");
  const [items, setItems] = useState<Item[]>([]);
  const [events, setEvents] = useState<BG[]>([]);
  const [tc, setTc] = useState<{ url: string; realm: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [results, setResults] = useState<ApproveResult[]>([]);
  const [note, setNote] = useState("");
  const [question, setQuestion] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const me: string = getValueFromIdToken("preferred_username") ?? "";

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await api<{ items: Item[]; tidecloak: { url: string; realm: string } }>("/api/approvals");
      setItems(r.items);
      setTc(r.tidecloak);
      const b = await api<{ events: BG[] }>("/api/break-glass");
      setEvents(b.events);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => {
    if (authenticated) load();
  }, [authenticated, load]);

  // On a wide screen the detail pane is never left blank: open the first item of the tab.
  useEffect(() => {
    if (selected || !loaded || window.matchMedia("(max-width: 900px)").matches) return;
    const first = tab === "requests" ? items[0]?.changeRequestId : events[0]?.id;
    if (first) setSelected(first);
  }, [selected, loaded, tab, items, events]);

  // Approve runs straight from the click so the Tide pop-up is not blocked.
  async function approve(ids: string[]) {
    if (!tc) return;
    setBusy(true);
    setErr(null);
    try {
      setResults(await approveChangeRequests(secureFetch as never, tc, ids));
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deny(id: string) {
    if (!tc) return;
    setBusy(true);
    try {
      await denyChangeRequest(secureFetch as never, tc, id);
      setSelected(null);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function ask(requestId: string) {
    setBusy(true);
    try {
      await api(`/api/emergency-requests/${requestId}/clarify`, { method: "POST", body: { text: question } });
      setQuestion("");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function review(id: string, decision: "justified" | "not_justified") {
    setBusy(true);
    try {
      await api(`/api/break-glass/${id}/review`, { method: "POST", body: { decision, note } });
      setNote("");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!authenticated) {
    return (
      <>
        <div className="title-row"><div><h1>Approvals</h1><p className="sub">Sign in with an approver account (Doctor B or C).</p></div></div>
        <button className="btn primary" onClick={login}>Sign in with Tide</button>
      </>
    );
  }

  const openReviews = events.filter((e) => e.status === "AWAITING_REVIEW");
  const signable = items.filter((i) => !i.blockedReason && !i.changeRequest?.authorizers?.some((a) => a.username === me));
  const sel = tab === "requests" ? items.find((i) => i.changeRequestId === selected) : undefined;
  const selBg = tab === "reviews" ? events.find((e) => e.id === selected) : undefined;
  const result = sel ? results.find((r) => r.id === sel.changeRequestId) : undefined;
  const now = Math.floor(Date.now() / 1000);
  const kinds = Object.entries(KIND_LOOK).map(([k, v]) => ({ key: k, ...v, value: items.filter((i) => i.kind === k).length }));
  const who = (it: Item) => it.subject.type === "User" ? displayName(it.subject.username ?? "?") : SUBJECT_TEXT[it.subject.id ?? ""] ?? it.subject.id;

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Approvals</h1>
          <p className="sub">
            {loaded ? (
              items.length || openReviews.length ? (
                <><b>{items.length} {items.length === 1 ? "request" : "requests"}</b> awaiting signatures, <b>{openReviews.length} break-glass {openReviews.length === 1 ? "event" : "events"}</b> awaiting review.</>
              ) : "Nothing is waiting for you."
            ) : "Loading…"}
          </p>
        </div>
        <div className="actions">
          {tab === "requests" && signable.length > 1 && (
            <button className="btn primary" disabled={busy} onClick={() => approve(signable.map((i) => i.changeRequestId))}>Approve all {signable.length}</button>
          )}
          <button className="btn" onClick={load}>Reload</button>
        </div>
      </div>

      {err && <p className="notice neg" style={{ marginBottom: 24 }}>{err}</p>}

      {loaded && (items.length > 0 || events.length > 0) && (
        <div className="chart-grid">
          <section className="panel span-4" aria-labelledby="q-h">
            <header><h2 id="q-h">Queue by type</h2></header>
            <Donut label="Requests awaiting signature by type" parts={kinds} center={items.length} sub="to sign" size={120} />
          </section>
          <section className="panel span-4" aria-labelledby="sig-h">
            <header><h2 id="sig-h">Signature progress</h2><span className="meta">Needs {items[0]?.changeRequest?.threshold ?? 2} signatures</span></header>
            <ul className="rows">
              {items.slice(0, 5).map((it) => {
                const n = it.changeRequest?.authorizationCount ?? 0, t = it.changeRequest?.threshold ?? 2;
                return (
                  <li key={it.changeRequestId} className="row" style={{ display: "grid", gap: 6, minHeight: 0, padding: "9px 0" }}>
                    <span className="small" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{who(it)} · <span className="mono">{it.recordId}</span></span>
                      <b className="num">{n}/{t}</b>
                    </span>
                    <Meter value={n} total={t} label={`Signatures for ${it.recordId}`} tone={n >= t ? "var(--positive)" : "var(--accent)"} />
                  </li>
                );
              })}
              {!items.length && <li className="small muted">No requests awaiting signature.</li>}
            </ul>
          </section>
          <section className="panel span-4" aria-labelledby="due-h">
            <header><h2 id="due-h">72 h review deadline</h2></header>
            <ul className="rows">
              {events.slice(0, 4).map((e) => {
                const total = e.reviewDueAt - e.declaredAt, used = Math.min(total, now - e.declaredAt), left = Math.max(0, e.reviewDueAt - now);
                const done = e.status !== "AWAITING_REVIEW";
                return (
                  <li key={e.id} className="row" style={{ display: "grid", gap: 6, minHeight: 0, padding: "9px 0" }}>
                    <span className="small" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span>{displayName(e.doctorUsername)} · <span className="mono">{e.recordId}</span></span>
                      <b className="num" style={{ color: e.overdue ? "var(--negative)" : undefined }}>{done ? BG_STATUS[e.status]?.text : e.overdue ? "Overdue" : `${Math.round(left / 3600)} h left`}</b>
                    </span>
                    <Meter value={done ? total : used} total={total} label={`Review time used for ${e.id}`} tone={done ? "var(--positive)" : e.overdue ? "var(--negative)" : "var(--warning)"} />
                    <span className="small faint">{e.reviews.length}/2 reviewers done</span>
                  </li>
                );
              })}
              {!events.length && <li className="small muted">No break-glass events yet.</li>}
            </ul>
          </section>
        </div>
      )}

      <div className="inbox" data-open={selected ? "true" : "false"}>
        <div className="inbox-side">
          <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
            <button role="tab" aria-selected={tab === "requests"} onClick={() => { setTab("requests"); setSelected(null); }}>To sign<span className="count">{items.length}</span></button>
            <button role="tab" aria-selected={tab === "reviews"} onClick={() => { setTab("reviews"); setSelected(null); }}>Break-glass<span className="count">{openReviews.length}</span></button>
          </div>
          <div className="inbox-list">
            {tab === "requests" && items.map((it) => {
              const who = it.subject.type === "User" ? displayName(it.subject.username ?? "?") : SUBJECT_TEXT[it.subject.id ?? ""] ?? it.subject.id;
              const signed = it.changeRequest?.authorizers?.some((a) => a.username === me);
              return (
                <button key={it.changeRequestId} className="inbox-item" aria-selected={selected === it.changeRequestId} onClick={() => setSelected(it.changeRequestId)}>
                  {it.subject.type === "User"
                    ? <span className="avatar" style={personTint(it.subject.username ?? "")}>{initials(it.subject.username ?? "?")}</span>
                    : <IconTile name="key" tone="teal" round />}
                  <span className="l1">
                    <b>{who}</b>
                    <span className="small faint">{it.request ? since(it.request.createdAt) : "enrollment"}</span>
                  </span>
                  <span className="l2">{it.request?.purpose === "patient-self" ? "Patient request: " : ""}{it.request ? it.request.reason : KIND_TEXT[it.kind]} · <span className="mono">{it.recordId}</span></span>
                  <span className="small faint">{it.changeRequest?.authorizationCount ?? 0}/{it.changeRequest?.threshold ?? 2} signatures{signed ? " · you signed" : ""}</span>
                </button>
              );
            })}
            {tab === "reviews" && events.map((e) => (
              <button key={e.id} className="inbox-item" aria-selected={selected === e.id} onClick={() => setSelected(e.id)}>
                <IconTile name="bolt" tone="orange" round />
                <span className="l1">
                  <b>{displayName(e.doctorUsername)}</b>
                  <span className="small faint">{since(e.declaredAt)}</span>
                </span>
                <span className="l2">{e.reason} · <span className="mono">{e.recordId}</span></span>
                <span className="small" style={{ color: e.overdue ? "var(--negative)" : "var(--faint)" }}>{BG_STATUS[e.status]?.text}{e.overdue ? " · overdue" : ""}</span>
              </button>
            ))}
            {((tab === "requests" && !items.length) || (tab === "reviews" && !events.length)) && (
              <p className="small muted" style={{ padding: 14 }}>{tab === "requests" ? "No requests awaiting signature." : "No break-glass events yet."}</p>
            )}
          </div>
        </div>

        <div className="inbox-detail">
          <button className="btn ghost back" onClick={() => setSelected(null)}><Icon name="back" />List</button>

          {!sel && !selBg && (
            <div className="empty">Pick an item on the left to see details.</div>
          )}

          {sel && (
            <div className="stack">
              <div className="panel">
                <header>
                  <h2>{sel.request ? `Request from ${displayName(sel.request.doctorUsername)}` : KIND_TEXT[sel.kind]}</h2>
                  {sel.request && <span className="meta mono">{sel.request.id}</span>}
                </header>
                <GrantCard
                  doctor={sel.subject.type === "User" ? sel.subject.username ?? "?" : SUBJECT_TEXT[sel.subject.id ?? ""] ?? sel.subject.id ?? ""}
                  verb={sel.roles.includes("_tide_decryptor") ? "Read grant" : "Write grant"}
                  person={sel.subject.type === "User"}
                  recordId={sel.recordId}
                  recordTitle={sel.recordTitle}
                  expiresAt={sel.expiry}
                  signed={sel.changeRequest?.authorizationCount ?? 0}
                  needed={sel.changeRequest?.threshold ?? 2}
                  signers={sel.changeRequest?.authorizers?.map((a) => a.username)}
                />
                <dl className="kv" style={{ marginTop: 16 }}>
                  <div><dt>Access:</dt><dd>{sel.roles.includes("_tide_decryptor") ? "Read only" : "Write only"}</dd></div>
                  {sel.request && <div><dt>Reason:</dt><dd>{sel.request.reason}</dd></div>}
                  {sel.request?.alertId && <div><dt>From alert:</dt><dd className="mono">{sel.request.alertId}</dd></div>}
                  {sel.request?.purpose === "patient-self" && <div><dt>Type:</dt><dd>Patient asks to read their own record</dd></div>}
                </dl>
                {sel.request && (
                  <div className="field" style={{ marginTop: 16 }}>
                    {sel.request.clarifications.map((c, i) => <p key={i} className="notice small">{displayName(c.by)} asked ({fmtTime(c.at)}): {c.text}</p>)}
                    {!sel.blockedReason && (
                      <>
                        <label htmlFor="ask-q">Ask the requester before signing</label>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <input id="ask-q" className="input" style={{ flex: "1 1 260px" }} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="E.g. is the latest INR result in yet?" />
                          <button className="btn" disabled={busy || question.trim().length < 5} onClick={() => ask(sel.request!.id)}>Send question</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {sel.blockedReason && <p className="notice neg" style={{ marginTop: 16 }}>{sel.blockedReason === "the requesting doctor cannot approve their own request" ? "You sent this request, so you cannot approve it yourself." : sel.blockedReason}</p>}
                <div className="row" style={{ borderTop: 0, paddingBottom: 0, flexWrap: "wrap", gap: 8 }}>
                  <button className="btn primary" disabled={busy || !!sel.blockedReason || !!sel.changeRequest?.authorizers?.some((a) => a.username === me)} onClick={() => approve([sel.changeRequestId])}>
                    {sel.changeRequest?.authorizers?.some((a) => a.username === me) ? "You signed" : "Approve"}
                  </button>
                  <button className="btn danger" disabled={busy} onClick={() => deny(sel.changeRequestId)}>Deny</button>
                </div>
                {result && (
                  <p className="small muted" style={{ marginTop: 12 }}>
                    {result.outcome === "recorded" ? (result.committed ? "All signatures in. The read grant is now active." : `Your signature is recorded (${result.authCount ?? "?"}/${result.threshold ?? "?"}).`) : result.outcome === "denied" ? "You cancelled in the Tide window." : `Error: ${result.message}`}
                  </p>
                )}
              </div>
              <p className="small faint">You sign with Tide on your own device, straight to TideCloak. The LifeKey server cannot sign for you.</p>
            </div>
          )}

          {selBg && (
            <div className="panel">
              <header>
                <div className="head">
                  <IconTile name="bolt" tone="orange" round />
                  <div><span className="label">Break-glass:</span><span className="value">{selBg.recordId}</span></div>
                </div>
                <span className={`pill ${BG_STATUS[selBg.status]?.cls}`}>{BG_STATUS[selBg.status]?.text}</span>
              </header>
              <dl className="kv">
                <div><dt>Doctor:</dt><dd><span className="avatar" style={{ ...personTint(selBg.doctorUsername), display: "inline-grid", width: 20, height: 20, fontSize: 11, marginRight: 6, verticalAlign: "middle" }}>{initials(selBg.doctorUsername)}</span>{displayName(selBg.doctorUsername)}</dd></div>
                <div><dt>At:</dt><dd className="num">{fmtTime(selBg.declaredAt)}</dd></div>
                <div><dt>Reason:</dt><dd>{selBg.reason}</dd></div>
                <div><dt>Notified:</dt><dd>{selBg.notified.map((n) => NOTIFIED_TEXT[n] ?? n).join(", ")}</dd></div>
                <div><dt>Review due:</dt><dd className="num" style={{ color: selBg.overdue ? "var(--negative)" : undefined }}>{fmtTime(selBg.reviewDueAt)}</dd></div>
              </dl>
              {selBg.patientObjection && <p className="notice warn" style={{ marginTop: 12 }}>The patient says this break-glass was not needed ({fmtTime(selBg.patientObjection.at)}): {selBg.patientObjection.note}</p>}
              <div style={{ margin: "16px 0 4px" }}>
                <Timeline label={`Timeline of ${selBg.id}`} start={selBg.declaredAt} end={selBg.reviewDueAt} now={selBg.status === "AWAITING_REVIEW" ? now : undefined}
                  marks={[
                    { at: selBg.declaredAt, text: `${displayName(selBg.doctorUsername)} opened the record`, tone: "var(--orange)" },
                    ...selBg.reviews.filter((r) => r.at).map((r) => ({ at: r.at!, text: `${displayName(r.reviewer)}: ${r.decision === "justified" ? "justified" : "not justified"}`, tone: r.decision === "justified" ? "var(--positive)" : "var(--negative)" })),
                    { at: selBg.reviewDueAt, text: "Review due", tone: "var(--label)" },
                  ]} />
              </div>
              {selBg.reviews.length > 0 && (
                <div className="rows" style={{ marginTop: 12 }}>
                  {selBg.reviews.map((r) => (
                    <div key={r.reviewer} className="row">
                      <span className="grow">{displayName(r.reviewer)}<span className="line2">{r.note}</span></span>
                      <span className={`pill ${r.decision === "justified" ? "pos" : "neg"}`}>{r.decision === "justified" ? "Justified" : "Not justified"}</span>
                    </div>
                  ))}
                </div>
              )}
              {selBg.status === "AWAITING_REVIEW" && (
                <div className="field" style={{ marginTop: 16 }}>
                  <label htmlFor="review-note">Review note</label>
                  <textarea id="review-note" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="E.g. patient unconscious, needed to know anticoagulants" />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn primary" disabled={busy} onClick={() => review(selBg.id, "justified")}>Justified</button>
                    <button className="btn danger" disabled={busy} onClick={() => review(selBg.id, "not_justified")}>Not justified</button>
                  </div>
                  <span className="hint">Needs 2 reviewers other than that doctor. One "not justified" vote flags the event and proposes revoking on-duty access.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
