"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useCallback, useEffect, useState } from "react";
import { decryptRecord, encryptRecord, networkReason, useApi } from "@/lib/client/api";
import { displayName } from "../AppShell";
import { BarList, Donut, DotMatrix } from "../charts";

const ACCOUNTS = ["admin", "doctor-a", "doctor-b", "doctor-c", "patient-alice"];
// Who stops each "deny" check, from the design's test table.
const BLOCKER: Record<string, string> = { A2: "ork", A3: "ork", A4: "ork", A5: "ork", A6: "ork", P1: "ork", P2: "ork", P3: "ork", R1: "ork", B1: "ork", S1: "tidecloak" };
const BLOCKER_LOOK: Record<string, { label: string; color: string }> = {
  ork: { label: "Mạng Tide chặn", color: "var(--teal)" },
  tidecloak: { label: "TideCloak chặn", color: "var(--orange)" },
  none: { label: "Cho phép", color: "var(--grey)" },
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
  const { authenticated, getValueFromIdToken } = useTideCloak();
  const api = useApi();
  const [data, setData] = useState<ProofData | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState(false);
  const me: string = getValueFromIdToken("preferred_username") ?? "";

  const load = useCallback(async () => setData(await api<ProofData>("/api/proof")), [api]);
  useEffect(() => {
    if (authenticated) load().catch(() => undefined);
  }, [authenticated, load]);

  if (!authenticated) return <p className="muted">Đăng nhập rồi chạy các phép thử cho tài khoản đó.</p>;
  if (!data) return <p className="muted">Đang tải…</p>;

  const pol = (kind: string, recordId: string) => data.policies.find((p) => p.kind === kind && p.recordId === recordId)?.policy;
  const authorizedA = data.requests.find((r) => r.doctorUsername === "doctor-a" && r.recordId === "MED-204" && r.status === "AUTHORIZED");
  const jitA = authorizedA ? data.policies.find((p) => p.name === authorizedA.policyName)?.policy : undefined;
  const ct = (id: string) => data.ciphertexts[id];
  const need = (...xs: (string | undefined)[]) => {
    if (xs.some((x) => !x)) throw Object.assign(new Error("chưa chạy được: cần đăng ký bệnh nhân hoặc một yêu cầu đã duyệt"), { skip: true });
  };
  const dec = async (ciphertext: string | undefined, tag: string, policy: string | undefined) => {
    need(ciphertext, policy);
    const out = await decryptRecord(ciphertext!, tag, policy!);
    return `đọc được ${out.length} ký tự`;
  };

  const checks: Check[] = [
    { id: "A1", who: ["doctor-a"], title: "A đọc MED-204 bằng quyền đã được duyệt cho A", expect: "allow", run: () => dec(ct("MED-204"), "MED-204", jitA) },
    { id: "A2", who: ["doctor-a"], title: "A dùng quyền MED-204 để đọc MED-205", expect: "deny", run: () => dec(ct("MED-205"), "MED-205", jitA) },
    { id: "A3", who: ["doctor-a"], title: "A dùng quyền MED-204 để đọc hồ sơ hạn chế PSY-301", expect: "deny", run: () => dec(ct("PSY-301"), "PSY-301", jitA) },
    { id: "A4", who: ["doctor-a"], title: "A gắn nhãn MED-204 lên bản mã của MED-205", expect: "deny", run: () => dec(ct("MED-205"), "MED-204", jitA) },
    {
      id: "A5", who: ["doctor-a"], title: "A dùng quyền chỉ-đọc để ghi đè MED-204", expect: "deny",
      run: async () => { need(jitA); await encryptRecord("tampered", "MED-204", jitA!); return "mã hoá được"; },
    },
    { id: "A6", who: ["doctor-a"], title: "A dùng quyền xem cảnh báo để đọc MED-204", expect: "deny", run: () => dec(ct("MED-204"), "MED-204", pol("tier1-standing", "T1-PAT-001")) },
    { id: "A7", who: ["doctor-a"], title: "A dùng quyền mở khẩn cấp mà không khai báo trên LifeKey. Mạng vẫn cho, vì lý do và thông báo chỉ do app kiểm soát (giới hạn đã biết)", expect: "allow", run: () => dec(ct("MED-204"), "MED-204", pol("break-glass-standing", "MED-204")) },
    { id: "A8", who: ["doctor-a"], title: "Bác sĩ đã xác minh xem cảnh báo cấp cứu", expect: "allow", run: () => dec(ct("T1-PAT-001"), "T1-PAT-001", pol("tier1-standing", "T1-PAT-001")) },
    { id: "P1", who: ["patient-alice"], title: "Bệnh nhân lấy được quyền của A và thử đọc MED-204", expect: "deny", run: () => dec(ct("MED-204"), "MED-204", jitA) },
    { id: "P2", who: ["patient-alice"], title: "Bệnh nhân không trực cấp cứu nhưng dùng quyền mở khẩn cấp", expect: "deny", run: () => dec(ct("MED-204"), "MED-204", pol("break-glass-standing", "MED-204")) },
    { id: "P3", who: ["patient-alice"], title: "Bệnh nhân dùng quyền xem cảnh báo của bác sĩ để đọc bản tóm tắt của mình", expect: "deny", run: () => dec(ct("T1-PAT-001"), "T1-PAT-001", pol("tier1-standing", "T1-PAT-001")) },
    { id: "R1", who: ["admin"], title: "Phòng hồ sơ đọc lại MED-204 bằng quyền ghi", expect: "deny", run: () => dec(ct("MED-204"), "MED-204", pol("recorder-write", "MED-204")) },
    { id: "B1", who: ["doctor-b", "doctor-c"], title: "Người duyệt thử xem cảnh báo cấp cứu", expect: "deny", run: () => dec(ct("T1-PAT-001"), "T1-PAT-001", pol("tier1-standing", "T1-PAT-001")) },
    {
      id: "S1", who: ["doctor-b", "doctor-c", "admin", "doctor-a", "patient-alice"], title: "Máy chủ dùng tài khoản quản trị để tự duyệt", expect: "deny",
      run: async () => {
        const id = data.pendingChangeRequests[0];
        need(id);
        const r = await api<{ recorded: boolean; before: number | null; after: number | null; attempt: { status: number; body: any } }>("/api/proof", { method: "POST", body: { changeRequestId: id } });
        const text = `HTTP ${r.attempt.status} ${r.attempt.body?.mode ?? r.attempt.body?.error ?? ""}; chữ ký ${r.before} → ${r.after}`;
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
          <h1>Kiểm chứng</h1>
          <p className="sub">
            {done.length
              ? <><b>{passed.length}/{done.length} phép thử đúng như mong đợi</b> với tài khoản {displayName(me)}.</>
              : "Mỗi phép thử đọc hoặc ghi thật trên mạng Tide bằng tài khoản đang đăng nhập."}
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={load} disabled={running}>Tải lại dữ liệu</button>
          <button className="btn primary" disabled={running} onClick={runAll}>{running ? "Đang chạy…" : `Chạy ${mine.length} phép thử`}</button>
        </div>
      </div>

      <p className="notice" style={{ marginBottom: 24 }}>
        Trang này cố ý đưa mọi quyền và mọi bản mã cho bất kỳ ai đăng nhập. Nếu chỉ máy chủ giữ an toàn, các phép thử "phải từ chối" sẽ lọt qua. Chúng bị chặn vì mạng Tide kiểm tra người gọi, hồ sơ và quyền ở mỗi lần giải mã.
        {authorizedA ? <> Quyền của A đang dùng: <span className="mono">{authorizedA.id}</span>.</> : " Chưa có quyền MED-204 nào của A được duyệt."}
      </p>

      <div className="chart-grid">
        <section className="panel span-4" aria-labelledby="res-h">
          <header><h2 id="res-h">Kết quả của bạn</h2></header>
          <Donut label="Kết quả phép thử" size={120} center={`${passed.length}/${mine.length}`} sub="đúng"
            parts={[
              { key: "pass", label: "Đúng", value: passed.length, color: "var(--positive)" },
              { key: "fail", label: "Sai", value: done.length - passed.length, color: "var(--negative)" },
              { key: "skip", label: "Chưa chạy được", value: skipped, color: "var(--warning)" },
              { key: "todo", label: "Chưa chạy", value: mine.length - done.length - skipped, color: "var(--control)" },
            ]} />
        </section>
        <section className="panel span-8" aria-labelledby="blk-h">
          <header><h2 id="blk-h">Ai chặn các phép thử</h2><span className="meta">{checks.length} phép thử</span></header>
          <BarList rows={blockers.map((b) => ({ key: b.key, label: b.label, value: b.value, color: b.color }))} />
          <p className="small faint" style={{ marginTop: 12 }}>Máy chủ LifeKey không chặn phép thử nào ở đây: mọi quyền và bản mã đều được phát cho người gọi, và mạng Tide vẫn từ chối.</p>
        </section>
        <section className="panel span-12" aria-labelledby="mx-h">
          <header>
            <h2 id="mx-h">Phép thử theo tài khoản</h2>
            <span className="legend-inline"><span><i style={{ background: "var(--positive)" }} />Mong đợi cho phép</span><span><i style={{ background: "transparent", boxShadow: "inset 0 0 0 2px var(--negative)" }} />Mong đợi từ chối</span></span>
          </header>
          <DotMatrix
            rows={checks.map((c) => ({ key: c.id, label: <><b>{c.id}</b><span>{c.title.length > 52 ? `${c.title.slice(0, 50)}…` : c.title}</span></> }))}
            cols={ACCOUNTS.map((a) => ({ key: a, label: a === me ? `${displayName(a)} (bạn)` : displayName(a) }))}
            cell={(id, acc) => {
              const c = checks.find((x) => x.id === id)!;
              if (!c.who.includes(acc)) return null;
              return c.expect === "allow"
                ? { color: "var(--positive)", tip: `${displayName(acc)} · ${id}: mong đợi cho phép` }
                : { color: "var(--negative)", hollow: true, tip: `${displayName(acc)} · ${id}: mong đợi từ chối` };
            }} />
        </section>
      </div>

      <div className="as-list">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Mã</th><th>Phép thử</th><th>Mong đợi</th><th className="n">Kết quả</th></tr></thead>
            <tbody>
              {mine.map((c) => {
                const r = results[c.id];
                const pass = r && r.outcome !== "skipped" && (r.outcome === "allowed") === (c.expect === "allow");
                return (
                  <tr key={c.id}>
                    <td className="mono">{c.id}</td>
                    <td>{c.title}{r && <span className="sub">{r.detail}</span>}</td>
                    <td data-l="Mong đợi">{c.expect === "allow" ? "Cho phép" : "Từ chối"}</td>
                    <td className="n">
                      {!r ? <span className="faint">—</span>
                        : r.outcome === "skipped" ? <span className="pill warn">Chưa chạy được</span>
                        : <span className={`pill ${pass ? "pos" : "neg"}`}>{pass ? "Đúng" : "Sai"}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Phép thử của tài khoản khác</h2>
        <div className="rows">
          {others.map((c) => (
            <div key={c.id} className="row">
              <span className="mono" style={{ width: 28 }}>{c.id}</span>
              <span className="grow">{c.title}<span className="line2">{c.who.map(displayName).join(", ")}</span></span>
              <span className="end muted">{c.expect === "allow" ? "Cho phép" : "Từ chối"}</span>
            </div>
          ))}
        </div>
        <p className="small faint" style={{ marginTop: 16 }}>Thử hết hạn: tạo một yêu cầu, chờ quá hạn rồi chạy lại A1. Kết quả phải là từ chối.</p>
      </section>
    </>
  );
}
