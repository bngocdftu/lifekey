"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useEffect, useState } from "react";
import { short, useApi } from "@/lib/client/api";
import { PATIENT } from "@/lib/lifekey/catalogue";
import type { Caller } from "@/lib/auth/caller";
import { displayName, initials, personTint } from "./AppShell";
import type { AuditEntry } from "@/lib/lifekey/audit";
import { AreaChart, Donut, StepTrack } from "./charts";
import { Icon, IconTile } from "./ui";

// What each demo account does next, in one line and one link.
const NEXT: Record<string, { text: string; href: string; cta: string }> = {
  admin: { text: "Enroll the sample patient and import records. You can write records but not read them back.", href: "/setup", cta: "Open patient enrollment" },
  "doctor-a": { text: "Open Alice's record. Emergency alerts show at once; detailed records need a grant.", href: `/emergency/${PATIENT.publicId}`, cta: "Open patient record" },
  "doctor-b": { text: "See requests waiting for your signature and break-glass openings to review.", href: "/approve", cta: "Open approval queue" },
  "doctor-c": { text: "See requests waiting for your signature and break-glass openings to review.", href: "/approve", cta: "Open approval queue" },
  "patient-alice": { text: "Choose which records an ER doctor may open at once, and see who has viewed yours.", href: "/me", cta: "Open my record" },
};

const WAYS = [
  { name: "Emergency alerts", icon: "heart", tone: "pink" as const, who: "Every verified clinician", wait: "As soon as you sign in", speed: 0, how: "Pre-approved when the patient enrolls." },
  { name: "Request access", icon: "key", tone: "teal" as const, who: "One doctor, one record", wait: "A few minutes", speed: 2, how: "Needs 2 approvers. Expires on its own after 2 hours." },
  { name: "Break glass", icon: "bolt", tone: "orange" as const, who: "On-duty ER doctor", wait: "A few seconds", speed: 1, how: "Only records the patient allows. Give a reason; reviewed afterwards." },
];
const SPEED = ["Instant", "Seconds", "Minutes"];

// What an account can do, checked against its roles.
const CAPS: { label: string; has: (me: Caller) => boolean }[] = [
  { label: "View alerts", has: (m) => m.realmRoles.includes("lifekey-clinician") },
  { label: "Break glass", has: (m) => m.realmRoles.includes("er-attending") },
  { label: "Read with a grant", has: (m) => m.realmRoles.includes("_tide_decryptor") },
  { label: "Write records", has: (m) => m.realmRoles.includes("lifekey-recorder") },
  { label: "Approve requests", has: (m) => m.isApprover },
  { label: "Sign own consent", has: (m) => m.realmRoles.includes("lifekey-patient") },
];

// A short to-do per demo account; "done" marks what the sample data already covers.
const STEPS: Record<string, { title: string; note: string; done?: boolean }[]> = {
  admin: [
    { title: "Send the grants the patient consented to", note: "Doctor B and C sign on the Approvals page" },
    { title: "Import 4 sample records", note: "Encrypted on this device; the server only keeps ciphertext" },
    { title: "Check that you cannot read them back", note: "Proof page, check R1" },
    { title: "Create sample requests for the demo", note: "Patient enrollment page, when LIFEKEY_DEMO_SEED=1" },
  ],
  "doctor-a": [
    { title: "View Alice's emergency alerts", note: "Warfarin, penicillin allergy, heart valve" },
    { title: "Request access to the medication list", note: "Wait for Doctor B and C to sign" },
    { title: "Try break glass", note: "Give a reason; approvers review it afterwards" },
  ],
  "doctor-b": [
    { title: "Sign pending requests", note: "Check the reason and expiry before signing" },
    { title: "Ask for details when a reason is unclear", note: "The requester sees your question on the request" },
    { title: "Review break-glass openings", note: "Due 72 hours after opening" },
  ],
  "doctor-c": [
    { title: "Sign pending requests", note: "A request needs 2 of 3 approvers" },
    { title: "Ask for details when a reason is unclear", note: "The requester sees your question on the request" },
    { title: "Review break-glass openings", note: "Due 72 hours after opening" },
  ],
  "patient-alice": [
    { title: "Sign consent", note: "Choose which records allow break-glass and what the emergency card shows" },
    { title: "See who has opened your records", note: "Every read, access request and break-glass shows here" },
    { title: "Request to view your records", note: "Two approvers sign, then you can read for 2 hours" },
    { title: "Follow break-glass openings", note: "Two approvers review within 72 hours" },
  ],
};

const ROLE_TEXT: Record<string, string> = {
  "lifekey-clinician": "Verified clinician",
  "er-attending": "On-duty ER",
  "lifekey-recorder": "Import records",
  "lifekey-patient": "Patient",
  _tide_decryptor: "Can read with a grant",
  _tide_encryptor: "Can write with a grant",
};

export default function HomePage() {
  const { authenticated, isInitializing, login } = useTideCloak();
  const api = useApi();
  const [me, setMe] = useState<Caller | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<AuditEntry[]>([]);

  useEffect(() => {
    if (!authenticated) return;
    api<Caller>("/api/session", { method: "POST", body: {} }).then(setMe).catch((e) => setError(e.message));
  }, [authenticated, api]);

  // Staff see the ward's log; a patient only the entries about their own records.
  useEffect(() => {
    if (!me) return;
    const patient = me.realmRoles.includes("lifekey-patient");
    (patient ? api<{ audit: AuditEntry[] }>("/api/my-record").then((d) => d.audit) : api<{ entries: AuditEntry[] }>("/api/audit").then((d) => d.entries))
      .then(setLog)
      .catch(() => undefined);
  }, [me, api]);

  if (isInitializing) return <p className="muted">Loading…</p>;

  if (!authenticated) {
    return (
      <>
        <div className="title-row">
          <div>
            <h1>LifeKey</h1>
            <p className="sub">ER doctors see allergies, current medicines and implants at once. Detailed records open only to the right person, for the right record, for a short time.</p>
          </div>
        </div>
        <div className="grid">
          <div className="panel span-7">
            <header><h2>Sign in</h2></header>
            <p className="muted">There are 5 test accounts: Records office, Doctor A, B, C and patient Alice. Use a separate browser profile for each.</p>
            <p style={{ marginTop: 16 }}><button className="btn primary" onClick={login}>Sign in with Tide</button></p>
          </div>
          <div className="panel well span-5">
            <header><h2>Demo build</h2></header>
            <p className="muted">All patients and records are synthetic. Not for use with real patients.</p>
          </div>
        </div>
      </>
    );
  }

  // The last 24 hours of the log, one point per hour.
  const hourNow = Math.floor(Date.now() / 3600_000) * 3600;
  const hours = Array.from({ length: 24 }, (_, i) => hourNow - (23 - i) * 3600);
  const perHour = hours.map((h) => log.filter((e) => e.at >= h && e.at < h + 3600).length);
  const hourLabels = hours.map((h) => new Date(h * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
  const denied = log.filter((e) => e.outcome === "denied" || e.outcome === "error").length;

  const next = me ? NEXT[me.username] : undefined;
  const steps = me ? STEPS[me.username] ?? [] : [];

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{me ? `Hello, ${displayName(me.username)}` : "Overview"}</h1>
          <p className="sub">{me?.realmRoles.includes("lifekey-patient") ? "Your emergency record · simulated hospital" : "Emergency department · simulated hospital"}</p>
        </div>
      </div>
      {error && <p className="notice neg" style={{ marginBottom: 20 }}>Could not load your account: {error}</p>}

      {log.length > 0 && (
        <div className="chart-grid">
          <section className="panel span-8" aria-labelledby="act-h">
            <header>
              <h2 id="act-h">{me?.realmRoles.includes("lifekey-patient") ? "Activity on your record" : "Activity in the last 24 hours"}</h2>
              <span className="meta num">{perHour.reduce((a, b) => a + b, 0)} events in 24 hours · <a className="link" href={me?.realmRoles.includes("lifekey-patient") ? "/me" : "/audit"}>View log</a></span>
            </header>
            <AreaChart points={perHour} labels={hourLabels} label="Log events per hour, last 24 hours" />
          </section>
          <section className="panel span-4" aria-labelledby="out-h">
            <header><h2 id="out-h">Access outcomes</h2></header>
            <Donut label="Access outcomes" size={116} center={`${Math.round(((log.length - denied) / log.length) * 100)}%`} sub="succeeded"
              parts={[
                { key: "ok", label: "Succeeded", value: log.length - denied, color: "var(--positive)" },
                { key: "bad", label: "Denied", value: denied, color: "var(--negative)" },
              ]} />
          </section>
        </div>
      )}

      <div className="grid">
        <div className="stack span-8">
          {next && (
            <section className="panel">
              <header>
                <h2>Your tasks today</h2>
                <span className="pill acc">{steps.filter((x) => x.done).length}/{steps.length}</span>
              </header>
              <ol className="todo">
                {steps.map((st) => (
                  <li key={st.title} className={st.done ? "done" : ""}>
                    <i className="dot" aria-hidden="true" />
                    <div><b>{st.title}</b><span>{st.note}</span></div>
                  </li>
                ))}
              </ol>
              <a className="btn primary" style={{ marginTop: 20 }} href={next.href}>{next.cta}</a>
            </section>
          )}

          <section>
            <div className="title-row" style={{ marginBottom: 12, alignItems: "baseline" }}>
              <h2 style={{ fontSize: 17, fontWeight: 600 }}>Three ways to see a record</h2>
            </div>
            <div className="tiles">
              {WAYS.map((w) => (
                <div key={w.name} className="tile">
                  <IconTile name={w.icon} tone={w.tone} />
                  <b>{w.name}</b>
                  <span>{w.who}</span>
                  <span className="pill" style={{ marginTop: 2 }}>{w.wait}</span>
                  <StepTrack steps={SPEED} at={w.speed} />
                  <span>{w.how}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="panel span-4">
          <div className="head" style={{ marginBottom: 14 }}>
            {me && <span className="avatar" style={{ ...personTint(me.username), width: 44, height: 44, fontSize: 15 }}>{initials(me.username)}</span>}
            <div><span className="label">Account:</span><span className="value">{me ? displayName(me.username) : "…"}</span></div>
          </div>
          {me ? (
            <>
              <dl className="kv">
                <div><dt>Username:</dt><dd>{me.username}</dd></div>
                <div><dt>Tide key:</dt><dd className="mono">{short(me.tideUserKey || "—", 6)}</dd></div>
                <div><dt>Approver:</dt><dd>{me.isApprover ? "Yes" : "No"}</dd></div>
              </dl>
              {!me.realmRoles.includes("lifekey-patient") && <div style={{ marginTop: 14 }}>
                <span className="small faint" style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span>What this account can do</span><b className="num" style={{ color: "var(--text)" }}>{CAPS.filter((c) => c.has(me)).length}/{CAPS.length}</b>
                </span>
                <ul className="caps">
                  {CAPS.map((c) => (
                    <li key={c.label} className={c.has(me) ? "on" : "off"}><Icon name={c.has(me) ? "tick" : "x"} />{c.label}</li>
                  ))}
                </ul>
              </div>}
              <div className="inset" style={{ marginTop: 14 }}>
                <span className="small faint" style={{ display: "block", marginBottom: 8 }}>Roles</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {me.realmRoles.filter((r) => ROLE_TEXT[r]).map((r) => <span key={r} className="pill acc">{ROLE_TEXT[r]}</span>)}
                  {!me.realmRoles.some((r) => ROLE_TEXT[r]) && <span className="small muted">No access to records</span>}
                </div>
              </div>
            </>
          ) : <p className="muted">Loading…</p>}
        </section>
      </div>
    </>
  );
}
