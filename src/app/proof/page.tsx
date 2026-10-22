"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useCallback, useEffect, useState } from "react";
import { decryptRecord, encryptRecord, networkReason, useApi } from "@/lib/client/api";
import { displayName } from "../AppShell";
import { BarList, Donut, DotMatrix } from "../charts";

const ACCOUNTS = ["admin", "doctor-a", "doctor-b", "doctor-c"];
// Who stops each "deny" check, from the design's test table.
const BLOCKER: Record<string, string> = { A2: "ork", A3: "ork", A4: "ork", A5: "ork", A6: "ork", B2: "ork", B3: "ork", R1: "ork", B1: "ork", S1: "tidecloak" };
const BLOCKER_LOOK: Record<string, { label: string; color: string }> = {
  ork: { label: "Blocked by the Tide network", color: "var(--teal)" },
  tidecloak: { label: "Blocked by TideCloak", color: "var(--orange)" },
  none: { label: "Allowed", color: "var(--grey)" },
};

// Live proof that the NETWORK enforces "this doctor, this record, this operation, until then".
// Every check runs the real encrypt/decrypt against the Tide ORKs with whoever is signed in.
// The server hands out every policy and every ciphertext here on purpose (see /api/proof).

interface ProofData {
  policies: { name: string; kind: string; recordId: string; subject: { type: string; id: string }; access: string; expiry?: number; policy: string }[];
  ciphertexts: Record<string, string>;
  requests: { id: string; recordId: string; doctorUsername: string; status: string; expiresAt: number; policyName: string }[];
  pendingChangeRequests: string[];
}

type Expect = "allow" | "deny";
interface Check {
  id: string;
  who: string[];
  title: string;
  expect: Expect;
  run: () => Promise<string>;
}
interface Result {
  outcome: "allowed" | "denied" | "skipped";
  detail: string;
}

export default function ProofPage() {
  const { authenticated, getValueFromIdToken, hasRealmRole } = useTideCloak();
  const api = useApi();
  const [data, setData] = useState<ProofData | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState(false);
  const me: string = getValueFromIdToken("preferred_username") ?? "";

  const load = useCallback(async () => setData(await api<ProofData>("/api/proof")), [api]);
  useEffect(() => {
    if (authenticated) load().catch(() => undefined);
  }, [authenticated, load]);

  if (!authenticated) return <p className="muted">Sign in, then run the checks for that account.</p>;
  if (hasRealmRole("lifekey-patient")) return <p className="notice">The Proof page is for hospital staff. See who has opened your records in <a className="link" href="/me">My record</a>.</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const pol = (kind: string, recordId: string) => data.policies.find((p) => p.kind === kind && p.recordId === recordId)?.policy;
  const authorizedA = data.requests.find((r) => r.doctorUsername === "doctor-a" && r.recordId === "MED-204" && r.status === "AUTHORIZED");
  const jitA = authorizedA ? data.policies.find((p) => p.name === authorizedA.policyName)?.policy : undefined;
  const ct = (id: string) => data.ciphertexts[id];
  const need = (...xs: (string | undefined)[]) => {
    if (xs.some((x) => !x)) throw Object.assign(new Error("could not run: needs patient enrollment or an approved request"), { skip: true });
  };
  const dec = async (ciphertext: string | undefined, tag: string, policy: string | undefined) => {
    need(ciphertext, policy);
    const out = await decryptRecord(ciphertext!, tag, policy!);
    return `read ${out.length} characters`;
  };

  const checks: Check[] = [
    { id: "A1", who: ["doctor-a"], title: "A reads MED-204 with the grant approved for A", expect: "allow", run: () => dec(ct("MED-204"), "MED-204", jitA) },
    { id: "A2", who: ["doctor-a"], title: "A uses the MED-204 grant to read MED-205", expect: "deny", run: () => dec(ct("MED-205"), "MED-205", jitA) },
    { id: "A3", who: ["doctor-a"], title: "A uses the MED-204 grant to read restricted record PSY-301", expect: "deny", run: () => dec(ct("PSY-301"), "PSY-301", jitA) },
    { id: "A4", who: ["doctor-a"], title: "A labels the MED-205 ciphertext as MED-204", expect: "deny", run: () => dec(ct("MED-205"), "MED-204", jitA) },
    {
      id: "A5", who: ["doctor-a"], title: "A uses a read-only grant to overwrite MED-204", expect: "deny",
      run: async () => { need(jitA); await encryptRecord("tampered", "MED-204", jitA!); return "encrypted"; },
    },
    { id: "A6", who: ["doctor-a"], title: "A uses the alert grant to read MED-204", expect: "deny", run: () => dec(ct("MED-204"), "MED-204", pol("tier1-standing", "T1-PAT-001")) },
    { id: "A7", who: ["doctor-a"], title: "A uses the break-glass grant without declaring it in LifeKey. The network allows it, since the reason and notices are enforced only by the app (known limit)", expect: "allow", run: () => dec(ct("MED-204"), "MED-204", pol("break-glass-standing", "MED-204")) },
    { id: "A8", who: ["doctor-a"], title: "Verified clinician views emergency alerts", expect: "allow", run: () => dec(ct("T1-PAT-001"), "T1-PAT-001", pol("tier1-standing", "T1-PAT-001")) },
    { id: "R1", who: ["admin"], title: "Records office reads MED-204 back with its write grant", expect: "deny", run: () => dec(ct("MED-204"), "MED-204", pol("recorder-write", "MED-204")) },
    { id: "B1", who: ["doctor-b", "doctor-c"], title: "Approver tries to view emergency alerts", expect: "deny", run: () => dec(ct("T1-PAT-001"), "T1-PAT-001", pol("tier1-standing", "T1-PAT-001")) },
    { id: "B2", who: ["doctor-b", "doctor-c"], title: "Approver uses the grant they just signed for A to read MED-204", expect: "deny", run: () => dec(ct("MED-204"), "MED-204", jitA) },
    { id: "B3", who: ["doctor-b", "doctor-c"], title: "Approver not on ER duty uses the break-glass grant", expect: "deny", run: () => dec(ct("MED-204"), "MED-204", pol("break-glass-standing", "MED-204")) },
    {
      id: "S1", who: ["doctor-b", "doctor-c", "admin", "doctor-a"], title: "Server uses the admin account to self-approve", expect: "deny",
      run: async () => {
        const id = data.pendingChangeRequests[0];
        need(id);
        const r = await api<{ recorded: boolean; before: number | null; after: number | null; attempt: { status: number; body: any } }>("/api/proof", { method: "POST", body: { changeRequestId: id } });
        const text = `HTTP ${r.attempt.status} ${r.attempt.body?.mode ?? r.attempt.body?.error ?? ""}; signatures ${r.before} → ${r.after}`;
        if (r.recorded) return text;
        throw new Error(text);
      },
    },
  ];

  async function runAll() {
    setRunning(true);
    const out: Record<string, Result> = {};
    for (const c of checks.filter((c) => c.who.includes(me))) {
      try {
        out[c.id] = { outcome: "allowed", detail: await c.run() };
      } catch (e) {
        out[c.id] = (e as { skip?: boolean }).skip ? { outcome: "skipped", detail: (e as Error).message } : { outcome: "denied", detail: networkReason(e) };
      }
      setResults({ ...out });
      if (out[c.id].outcome !== "skipped") {
        await api("/api/audit", { method: "POST", body: { action: `proof.${c.id.toLowerCase()}`, resource: c.title.slice(0, 64), outcome: out[c.id].outcome === "allowed" ? "ok" : "denied", detail: out[c.id].detail } }).catch(() => undefined);
      }
    }
    setRunning(false);
  }

  const mine = checks.filter((c) => c.who.includes(me));
  const others = checks.filter((c) => !c.who.includes(me));
  const done = mine.filter((c) => results[c.id] && results[c.id].outcome !== "skipped");
  const passed = done.filter((c) => (results[c.id].outcome === "allowed") === (c.expect === "allow"));
  const skipped = mine.filter((c) => results[c.id]?.outcome === "skipped").length;
  const blockers = Object.entries(BLOCKER_LOOK).map(([k, v]) => ({ key: k, label: v.label, color: v.color, value: checks.filter((c) => (BLOCKER[c.id] ?? "none") === k).length }));

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Proof</h1>
          <p className="sub">
            {done.length
              ? <><b>{passed.length}/{done.length} checks behaved as expected</b> for {displayName(me)}.</>
              : "Each check really reads or writes on the Tide network as the signed-in account."}
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={load} disabled={running}>Reload data</button>
          <button className="btn primary" disabled={running} onClick={runAll}>{running ? "Running…" : `Run ${mine.length} checks`}</button>
        </div>
      </div>

      <p className="notice" style={{ marginBottom: 24 }}>
        This page deliberately hands every grant and every ciphertext to anyone signed in. If only the server kept things safe, the "expected deny" checks would get through. They are blocked because the Tide network checks the caller, the record and the grant on every decryption.
        {authorizedA ? <> A's grant in use: <span className="mono">{authorizedA.id}</span>.</> : " No MED-204 grant for A has been approved yet."}
      </p>

      <div className="chart-grid">
        <section className="panel span-4" aria-labelledby="res-h">
          <header><h2 id="res-h">Your results</h2></header>
          <Donut label="Check results" size={120} center={`${passed.length}/${mine.length}`} sub="pass"
            parts={[
              { key: "pass", label: "Pass", value: passed.length, color: "var(--positive)" },
              { key: "fail", label: "Fail", value: done.length - passed.length, color: "var(--negative)" },
              { key: "skip", label: "Could not run", value: skipped, color: "var(--warning)" },
              { key: "todo", label: "Not run yet", value: mine.length - done.length - skipped, color: "var(--control)" },
            ]} />
        </section>
        <section className="panel span-8" aria-labelledby="blk-h">
          <header><h2 id="blk-h">Who blocks each check</h2><span className="meta">{checks.length} checks</span></header>
          <BarList rows={blockers.map((b) => ({ key: b.key, label: b.label, value: b.value, color: b.color }))} />
          <p className="small faint" style={{ marginTop: 12 }}>The LifeKey server blocks none of these checks: every grant and ciphertext is handed to the caller, and the Tide network still refuses.</p>
        </section>
        <section className="panel span-12" aria-labelledby="mx-h">
          <header>
            <h2 id="mx-h">Checks by account</h2>
            <span className="legend-inline"><span><i style={{ background: "var(--positive)" }} />Expected allow</span><span><i style={{ background: "transparent", boxShadow: "inset 0 0 0 2px var(--negative)" }} />Expected deny</span></span>
          </header>
          <DotMatrix
            rows={checks.map((c) => ({ key: c.id, label: <><b>{c.id}</b><span>{c.title.length > 52 ? `${c.title.slice(0, 50)}…` : c.title}</span></> }))}
            cols={ACCOUNTS.map((a) => ({ key: a, label: a === me ? `${displayName(a)} (you)` : displayName(a) }))}
            cell={(id, acc) => {
              const c = checks.find((x) => x.id === id)!;
              if (!c.who.includes(acc)) return null;
              return c.expect === "allow"
                ? { color: "var(--positive)", tip: `${displayName(acc)} · ${id}: expected allow` }
                : { color: "var(--negative)", hollow: true, tip: `${displayName(acc)} · ${id}: expected deny` };
            }} />
        </section>
      </div>

      <div className="as-list">
        <div className="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Check</th><th>Expected</th><th className="n">Result</th></tr></thead>
            <tbody>
              {mine.map((c) => {
                const r = results[c.id];
                const pass = r && r.outcome !== "skipped" && (r.outcome === "allowed") === (c.expect === "allow");
                return (
                  <tr key={c.id}>
                    <td className="mono">{c.id}</td>
                    <td>{c.title}{r && <span className="sub">{r.detail}</span>}</td>
                    <td data-l="Expected">{c.expect === "allow" ? "Allow" : "Deny"}</td>
                    <td className="n">
                      {!r ? <span className="faint">—</span>
                        : r.outcome === "skipped" ? <span className="pill warn">Could not run</span>
                        : <span className={`pill ${pass ? "pos" : "neg"}`}>{pass ? "Pass" : "Fail"}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Checks for other accounts</h2>
        <div className="rows">
          {others.map((c) => (
            <div key={c.id} className="row">
              <span className="mono" style={{ width: 28 }}>{c.id}</span>
              <span className="grow">{c.title}<span className="line2">{c.who.map(displayName).join(", ")}</span></span>
              <span className="end muted">{c.expect === "allow" ? "Allow" : "Deny"}</span>
            </div>
          ))}
        </div>
        <p className="small faint" style={{ marginTop: 16 }}>To test expiry: create a request, wait until it expires, then run A1 again. It must be denied.</p>
      </section>
    </>
  );
}
