"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useCallback, useEffect, useState } from "react";
import { PATIENT, RECORDS, SYNTHETIC_PLAINTEXT } from "@/lib/lifekey/catalogue";
import { encryptRecord, fmtTime, networkReason, useApi } from "@/lib/client/api";
import type { PatientConsent } from "@/lib/lifekey/consent";
import { BarList, DotMatrix, Meter } from "../charts";
import { Ring } from "../ui";

interface PolicyRow {
  name: string;
  spec: { kind: string; recordId: string; subject: { type: string; id: string }; access: string; expiry?: number };
  changeRequestId?: string;
  status: string;
  statusReason?: string;
  signed: boolean;
}

const TIER_LOOK: Record<number, { label: string; color: string }> = {
  1: { label: "Tier 1 · alerts", color: "var(--pink)" },
  2: { label: "Tier 2 · detailed", color: "var(--teal)" },
  3: { label: "Tier 3 · restricted", color: "var(--grey)" },
};
// Who may open a record, by tier and the patient's break-glass choice.
const ACCESS_COLS = [
  { key: "clinician", label: "Verified clinician" },
  { key: "jit", label: "Request access (2 signatures)" },
  { key: "bg", label: "Break glass" },
  { key: "recorder", label: "Records office writes" },
];

const KIND_TEXT: Record<string, string> = {
  "tier1-standing": "Verified clinicians view emergency alerts",
  "recorder-write": "Records office may write",
  "break-glass-standing": "On-duty ER doctor may break glass",
};

// Enrollment: the patient's consents become grants the approvers sign once; then the records office
// encrypts each record in this browser and the server keeps ciphertext only.
export default function SetupPage() {
  const { authenticated, login } = useTideCloak();
  const api = useApi();
  const [rows, setRows] = useState<PolicyRow[]>([]);
  const [stored, setStored] = useState<string[]>([]);
  const [consent, setConsent] = useState<PatientConsent | null>(null);
  const [toFile, setToFile] = useState(0);
  const [seedOn, setSeedOn] = useState(false);
  const [seeded, setSeeded] = useState<{ created: string[]; skipped: string[] } | null>(null);
  const [log, setLog] = useState<{ id: string; ok: boolean; text: string; size?: number }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ policies: PolicyRow[]; ciphertexts: string[]; consent: PatientConsent | null; toFile: number }>("/api/setup");
      setRows(r.policies);
      setStored(r.ciphertexts);
      setConsent(r.consent);
      setToFile(r.toFile);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [api]);

  useEffect(() => {
    if (!authenticated) return;
    refresh();
    api<{ enabled: boolean }>("/api/demo-seed").then((r) => setSeedOn(r.enabled)).catch(() => setSeedOn(false));
  }, [authenticated, refresh, api]);

  async function seedDemo() {
    setBusy(true);
    try {
      setSeeded(await api<{ created: string[]; skipped: string[] }>("/api/demo-seed", { method: "POST", body: {} }));
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function enroll() {
    setBusy(true);
    try {
      await api("/api/setup", { method: "POST", body: {} });
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function seed() {
    setBusy(true);
    const out: typeof log = [];
    for (const r of RECORDS) {
      try {
        const { policy } = await api<{ policy: string }>(`/api/policies?purpose=write&record=${r.id}`);
        const ciphertext = await encryptRecord(JSON.stringify(SYNTHETIC_PLAINTEXT[r.id]), r.id, policy);
        await api(`/api/records/${r.id}`, { method: "PUT", body: { ciphertext } });
        out.push({ id: r.id, ok: true, size: ciphertext.length, text: `Encrypted on this device; the server only received ${ciphertext.length.toLocaleString("en-GB")} characters of ciphertext.` });
      } catch (e) {
        out.push({ id: r.id, ok: false, text: networkReason(e) });
      }
      setLog([...out]);
    }
    await refresh();
    setBusy(false);
  }

  if (!authenticated) {
    return (
      <>
        <div className="title-row"><div><h1>Patient enrollment</h1><p className="sub">Sign in with the Records office account.</p></div></div>
        <button className="btn primary" onClick={login}>Sign in with Tide</button>
      </>
    );
  }

  const signed = rows.filter((r) => r.signed).length;
  const bgIds = consent?.breakGlass ?? [];
  const allSigned = rows.length > 0 && signed === rows.length;

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Patient enrollment</h1>
          <p className="sub">{PATIENT.displayName} · <span className="mono">{PATIENT.id}</span></p>
        </div>
        <div className="actions"><button className="btn" onClick={refresh}>Reload</button></div>
      </div>
      {err && <p className="notice neg" style={{ marginBottom: 24 }}>{err}</p>}

      <div className="kpis summary" style={{ marginBottom: "var(--gap)" }}>
        <div className="kpi">
          <div className="kpi-label">Grants signed</div>
          <div className="kpi-value">{signed}<small>/ {rows.length || 6}</small></div>
          <div className="kpi-chart"><Meter value={signed} total={rows.length || 6} label="Grants signed" tone={allSigned ? "var(--positive)" : "var(--accent)"} /></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Records imported</div>
          <div className="chart-row">
            <Ring value={stored.length} total={RECORDS.length} icon="file" size={56} />
            <div className="kpi-value" style={{ marginTop: 0 }}>{stored.length}<small>/ {RECORDS.length} records</small></div>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Records by protection tier</div>
          <div className="kpi-value">{RECORDS.length}<small>records · {bgIds.length} allow break-glass</small></div>
          <div className="kpi-chart">
            <BarList rows={[1, 2, 3].map((t) => ({ key: String(t), label: TIER_LOOK[t].label, value: RECORDS.filter((r) => r.tier === t).length, color: TIER_LOOK[t].color }))} />
          </div>
        </div>
      </div>

      <div className="chart-grid">
        <section className="panel span-7" aria-labelledby="who-open-h">
          <header><h2 id="who-open-h">Who can open which record</h2><span className="meta">As the patient consented</span></header>
          <DotMatrix
            rows={RECORDS.map((r) => ({ key: r.id, label: <><b>{r.title}</b><span>{r.id} · Tier {r.tier}</span></> }))}
            cols={ACCESS_COLS}
            cell={(id, col) => {
              const r = RECORDS.find((x) => x.id === id)!;
              const color = TIER_LOOK[r.tier].color;
              if (col === "recorder") return { color, tip: `Records office can write ${id} but cannot read it back`, hollow: true };
              if (col === "clinician" && r.tier === 1) return { color, tip: `Every verified clinician can read ${id}` };
              if (col === "jit" && r.tier === 2) return { color, tip: `One doctor can read ${id} with 2 signatures, for 2 hours` };
              if (col === "bg" && bgIds.includes(r.id)) return { color, tip: `On-duty ER doctor can break glass on ${id}, reviewed afterwards` };
              return null;
            }} />
          <p className="small faint" style={{ marginTop: 10 }}>Filled dot: can read. Hollow dot: can only write.</p>
        </section>
        <section className="panel span-5" aria-labelledby="ct-h">
          <header><h2 id="ct-h">What the server receives</h2><span className="meta">Ciphertext characters</span></header>
          {log.some((l) => l.size) ? (
            <BarList unit="" rows={log.filter((l) => l.size).map((l) => ({ key: l.id, label: <span className="mono">{l.id}</span>, value: l.size!, color: "var(--grey)", note: `${l.id}: ciphertext characters` }))} />
          ) : (
            <p className="small muted">After import, this chart shows the length of ciphertext the server received for each record. The server never sees plaintext.</p>
          )}
        </section>
      </div>

      <div className="setting">
        <div>
          <h2>What the patient consented to</h2>
          <p className="desc">The patient signs consent from their own account. Each item they consent to becomes a grant, and a grant takes effect only once approvers sign it. After you send them, Doctor B and C sign on the Approvals page.</p>
          <div className={`notice ${consent ? "acc" : "warn"}`} style={{ marginTop: 16 }}>
            {consent
              ? <>The patient signed version {consent.version} at {fmtTime(consent.signedAt)}. Break-glass allowed for: <b>{bgIds.join(", ") || "no records"}</b>.</>
              : "Waiting for the patient to sign consent on the My record page. No grants can be sent yet."}
          </div>
          <p style={{ marginTop: 16 }}>
            <button className="btn primary" disabled={busy || !consent || (rows.length > 0 && toFile === 0)} onClick={enroll}>
              {!rows.length ? "Send to approvers" : toFile ? `Send ${toFile} more grants` : "Sent to approvers"}
            </button>
          </p>
        </div>
        <div className="panel flush as-list">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Grant</th><th>Record</th><th>Expires</th><th className="n">Status</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td>{KIND_TEXT[r.spec.kind] ?? r.spec.kind}{r.statusReason && <span className="sub err">{r.statusReason}</span>}</td>
                    <td data-l="Record" className="mono">{r.spec.recordId}</td>
                    <td data-l="Expires" className="num">{fmtTime(r.spec.expiry)}</td>
                    <td className="n"><span className={`pill ${r.signed ? "pos" : r.status === "FAILED" ? "neg" : "warn"}`}>{r.signed ? "Signed" : r.status === "FAILED" ? "Error" : "Awaiting signature"}</span></td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={4} className="muted">Not sent yet. Press "Send to approvers" to create 6 grants.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {seedOn && (
        <div className="setting">
          <div>
            <h2>Sample requests for the demo</h2>
            <p className="desc">Files 2 requests from Doctor A, 1 view request from the patient and 1 break-glass (if the patient allowed it), so every account has work on screen. Each request still waits for real approver signatures. The log records which account "demo-seed" acted for.</p>
            <p style={{ marginTop: 16 }}><button className="btn" disabled={busy} onClick={seedDemo}>Create sample requests</button></p>
            <p className="small faint" style={{ marginTop: 8 }}>Doctor A and the patient must sign in at least once first, so LifeKey knows their Tide keys.</p>
          </div>
          <div className="panel">
            {seeded ? (
              <div className="rows">
                {seeded.created.map((c) => <div key={c} className="row"><span className="grow mono">{c}</span><span className="pill pos">Created</span></div>)}
                {seeded.skipped.map((c) => <div key={c} className="row"><span className="grow small">{c}</span><span className="pill">Skipped</span></div>)}
              </div>
            ) : <p className="small muted">Nothing created yet. Results show here.</p>}
          </div>
        </div>
      )}

      <div className="setting">
        <div>
          <h2>Import records</h2>
          <p className="desc">Records are encrypted right here in this browser. The records office can only write, so it cannot read them back after import.</p>
          <p style={{ marginTop: 16 }}><button className="btn primary" disabled={busy || !allSigned} onClick={seed}>Import {RECORDS.length} sample records</button></p>
          {!allSigned && rows.length > 0 && <p className="small faint" style={{ marginTop: 8 }}>Waiting for all {rows.length} grants to be signed.</p>}
        </div>
        <div className="panel">
          <div className="rows">
            {RECORDS.map((r) => {
              const l = log.find((x) => x.id === r.id);
              const has = stored.includes(r.id);
              return (
                <div key={r.id} className="row">
                  <span className="grow">{r.title}<span className="line2"><span className="mono">{r.id}</span>{l ? ` · ${l.text}` : ""}</span></span>
                  <span className={`pill ${has ? "pos" : l && !l.ok ? "neg" : ""}`}>{has ? "Imported" : l && !l.ok ? "Error" : "Not imported"}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
