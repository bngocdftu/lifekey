"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useCallback, useEffect, useState } from "react";
import { fmtTime, useApi } from "@/lib/client/api";
import type { AuditEntry } from "@/lib/lifekey/audit";
import { displayName } from "../AppShell";
import { BarList, Columns, Donut, HashChain, timeBuckets } from "../charts";

// Actions as a clerk would write them in the ward book.
const ACTION_TEXT: Record<string, string> = {
  "session.first-sign-in": "First sign-in",
  "patient.lookup": "Opened patient record",
  "record.write": "Imported record",
  "record.decrypt": "Read record",
  "grant.file": "Sent grant to approvers",
  "grant.signed": "Grant signed",
  "grant.denied": "Grant denied",
  "grant.verify": "Grant mismatch",
  "request.create": "Request access",
  "request.status": "Request status changed",
  "break-glass.declare": "Break glass",
  "break-glass.review": "Break-glass review",
  "policy.release.tier1": "Fetched alert grant",
  "policy.release.write": "Fetched write grant",
  "policy.release.break-glass": "Fetched break-glass grant",
  "policy.release.request": "Fetched approved read grant",
  "proof.server-approve": "Server tried to self-approve",
  "consent.sign": "Patient signed consent",
  "request.clarify": "Approver asked for details",
  "break-glass.objection": "Patient objected to break-glass",
};
// Kinds of work, for the donut: grouped the way a ward would count them.
const GROUPS: { key: string; label: string; color: string; match: (a: string) => boolean }[] = [
  { key: "read", label: "Record reads and writes", color: "var(--teal)", match: (a) => a.startsWith("record.") || a === "patient.lookup" },
  { key: "grant", label: "Grants", color: "var(--green)", match: (a) => a.startsWith("grant.") || a.startsWith("policy.") || a.startsWith("consent.") },
  { key: "request", label: "Access requests", color: "var(--orange)", match: (a) => a.startsWith("request.") },
  { key: "bg", label: "Break-glass", color: "var(--pink)", match: (a) => a.startsWith("break-glass.") },
  { key: "other", label: "Other", color: "var(--grey)", match: () => true },
];

const OUTCOME: Record<string, { text: string; cls: string }> = {
  ok: { text: "Succeeded", cls: "pos" },
  denied: { text: "Denied", cls: "neg" },
  error: { text: "Error", cls: "neg" },
  info: { text: "Recorded", cls: "" },
};

export default function AuditPage() {
  const { authenticated, login } = useTideCloak();
  const api = useApi();
  const [data, setData] = useState<{ entries: AuditEntry[]; brokenAt: number | null; head: string | null } | null>(null);
  const [filter, setFilter] = useState<"all" | "denied">("all");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => api("/api/audit").then((d) => { setData(d); setErr(null); }).catch((e) => setErr(e.message)), [api]);
  useEffect(() => {
    if (authenticated) load();
  }, [authenticated, load]);

  if (!authenticated) {
    return (
      <>
        <div className="title-row"><div><h1>Access log</h1><p className="sub">Sign in to view.</p></div></div>
        <button className="btn primary" onClick={login}>Sign in with Tide</button>
      </>
    );
  }

  const entries = (data?.entries ?? []).filter((e) => filter === "all" || e.outcome === "denied" || e.outcome === "error");
  const deniedCount = (data?.entries ?? []).filter((e) => e.outcome === "denied" || e.outcome === "error").length;

  const all = data?.entries ?? [];
  const buckets = timeBuckets(all);
  const byActor = Object.entries(all.reduce<Record<string, number>>((m, e) => ({ ...m, [e.actor]: (m[e.actor] ?? 0) + 1 }), {}))
    .sort((a, b) => b[1] - a[1]);
  const groupCounts = GROUPS.map((g) => ({ key: g.key, label: g.label, color: g.color, value: all.filter((e) => GROUPS.find((x) => x.match(e.action))?.key === g.key).length }));
  const chain = [...all].reverse().slice(-14);

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Access log</h1>
          <p className="sub">
            {data ? (
              data.brokenAt === null
                ? <>{data.entries.length.toLocaleString("en-GB")} entries, hash chain <b>intact</b>.</>
                : <>Hash chain <b style={{ color: "var(--negative)" }}>altered from entry {data.brokenAt}</b>.</>
            ) : "Loading…"}
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={load}>Reload</button>
        </div>
      </div>
      {err && <p className="notice neg" style={{ marginBottom: 24 }}>{err}</p>}

      {all.length > 0 && (
        <div className="chart-grid">
          <section className="panel span-8" aria-labelledby="act-h">
            <header>
              <h2 id="act-h">Activity by hour</h2>
              <span className="legend-inline"><span><i style={{ background: "var(--positive)" }} />Succeeded</span><span><i style={{ background: "var(--negative)" }} />Denied</span></span>
            </header>
            <Columns buckets={buckets} label="Events per hour, split into succeeded and denied" every={Math.max(1, Math.ceil(buckets.length / 8))} />
          </section>
          <section className="panel span-4" aria-labelledby="kind-h">
            <header><h2 id="kind-h">By type of event</h2></header>
            <Donut label="Events by type" parts={groupCounts} center={all.length} sub="entries" />
          </section>
          <section className="panel span-6" aria-labelledby="who-h">
            <header><h2 id="who-h">Most active accounts</h2><span className="meta">Log entries</span></header>
            <BarList rows={byActor.map(([a, n]) => ({ key: a, label: a === "lifekey-server" ? "Server" : displayName(a), value: n, note: a }))} />
          </section>
          <section className="panel span-6" aria-labelledby="chain-h">
            <header>
              <h2 id="chain-h">Hash chain</h2>
              <span className={`pill ${data?.brokenAt === null ? "pos" : "neg"}`}>{data?.brokenAt === null ? "Intact" : `Broken from entry ${data?.brokenAt}`}</span>
            </header>
            <HashChain brokenAt={data?.brokenAt ?? null} items={chain.map((e) => ({
              seq: e.seq, hash: e.hash, ok: e.outcome !== "denied" && e.outcome !== "error",
              tip: `#${e.seq} ${ACTION_TEXT[e.action] ?? e.action} · ${OUTCOME[e.outcome]?.text ?? e.outcome}`,
            }))} />
            <p className="small faint" style={{ marginTop: 12 }}>{chain.length} most recent entries. Each entry carries the hash of the one before, so editing or deleting an entry breaks the chain from that point.</p>
          </section>
        </div>
      )}

      <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
        <button role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>All<span className="count">{data?.entries.length ?? 0}</span></button>
        <button role="tab" aria-selected={filter === "denied"} onClick={() => setFilter("denied")}>Denied<span className="count">{deniedCount}</span></button>
      </div>

      <div className="as-list audit-table">
        <div className="table-wrap">
          <table>
            <thead><tr><th className="n">#</th><th>When</th><th>Who</th><th>Action</th><th>Record</th><th className="n">Outcome</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.seq}>
                  <td className="n faint seq">{e.seq}</td>
                  <td className="num meta-cell">{fmtTime(e.at)}</td>
                  <td className="meta-cell">{e.actor === "lifekey-server" ? "Server" : displayName(e.actor)}</td>
                  <td className="act">{ACTION_TEXT[e.action] ?? e.action}{e.detail && <span className="sub">{e.detail.replace(/^client-reported: /, "Browser reported: ")}</span>}</td>
                  <td className="mono meta-cell">{e.resource}</td>
                  <td className="n res"><span className={`pill ${OUTCOME[e.outcome]?.cls ?? ""}`}>{OUTCOME[e.outcome]?.text ?? e.outcome}</span></td>
                </tr>
              ))}
              {!entries.length && <tr><td colSpan={6} className="muted">{filter === "denied" ? "Nothing has been denied yet." : "No entries yet."}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="small faint" style={{ marginTop: 16 }}>The log never contains record contents. "Browser reported" entries come from the doctor's device, because the server cannot see decryption happen.</p>
    </>
  );
}
