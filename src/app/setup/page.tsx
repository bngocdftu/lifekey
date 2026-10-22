"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useCallback, useEffect, useState } from "react";
import { PATIENT, RECORDS, SYNTHETIC_PLAINTEXT } from "@/lib/lifekey/catalogue";
import { encryptRecord, fmtTime, networkReason, useApi } from "@/lib/client/api";
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
  1: { label: "Tier 1 · cảnh báo", color: "var(--pink)" },
  2: { label: "Tier 2 · chi tiết", color: "var(--teal)" },
  3: { label: "Tier 3 · hạn chế", color: "var(--grey)" },
};
// Who may open a record, by tier and the patient's break-glass choice.
const ACCESS_COLS = [
  { key: "clinician", label: "Bác sĩ đã xác minh" },
  { key: "jit", label: "Xin quyền (2 chữ ký)" },
  { key: "bg", label: "Mở khẩn cấp" },
  { key: "recorder", label: "Phòng hồ sơ ghi" },
];

const KIND_TEXT: Record<string, string> = {
  "tier1-standing": "Bác sĩ đã xác minh xem cảnh báo cấp cứu",
  "recorder-write": "Phòng hồ sơ được ghi",
  "break-glass-standing": "Bác sĩ trực được mở khẩn cấp",
};

// Enrollment: the patient's consents become grants the approvers sign once; then the records office
// encrypts each record in this browser and the server keeps ciphertext only.
export default function SetupPage() {
  const { authenticated, login } = useTideCloak();
  const api = useApi();
  const [rows, setRows] = useState<PolicyRow[]>([]);
  const [stored, setStored] = useState<string[]>([]);
  const [log, setLog] = useState<{ id: string; ok: boolean; text: string; size?: number }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ policies: PolicyRow[]; ciphertexts: string[] }>("/api/setup");
      setRows(r.policies);
      setStored(r.ciphertexts);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [api]);

  useEffect(() => {
    if (authenticated) refresh();
  }, [authenticated, refresh]);

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
        out.push({ id: r.id, ok: true, size: ciphertext.length, text: `Đã mã hoá trên máy này, máy chủ chỉ nhận ${ciphertext.length.toLocaleString("vi-VN")} ký tự mã hoá.` });
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
        <div className="title-row"><div><h1>Đăng ký bệnh nhân</h1><p className="sub">Đăng nhập bằng tài khoản Phòng hồ sơ.</p></div></div>
        <button className="btn primary" onClick={login}>Đăng nhập bằng Tide</button>
      </>
    );
  }

  const signed = rows.filter((r) => r.signed).length;
  const allSigned = rows.length > 0 && signed === rows.length;

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Đăng ký bệnh nhân</h1>
          <p className="sub">{PATIENT.displayName} · <span className="mono">{PATIENT.id}</span></p>
        </div>
        <div className="actions"><button className="btn" onClick={refresh}>Tải lại</button></div>
      </div>
      {err && <p className="notice neg" style={{ marginBottom: 24 }}>{err}</p>}

      <div className="kpis summary" style={{ marginBottom: "var(--gap)" }}>
        <div className="kpi">
          <div className="kpi-label">Quyền đã ký</div>
          <div className="kpi-value">{signed}<small>/ {rows.length || 6}</small></div>
          <div className="kpi-chart"><Meter value={signed} total={rows.length || 6} label="Quyền đã ký" tone={allSigned ? "var(--positive)" : "var(--accent)"} /></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Hồ sơ đã nhập</div>
          <div className="chart-row">
            <Ring value={stored.length} total={RECORDS.length} icon="file" size={56} />
            <div className="kpi-value" style={{ marginTop: 0 }}>{stored.length}<small>/ {RECORDS.length} hồ sơ</small></div>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Hồ sơ theo mức bảo vệ</div>
          <div className="kpi-value">{RECORDS.length}<small>hồ sơ · {RECORDS.filter((r) => r.breakGlassEligible).length} cho mở khẩn cấp</small></div>
          <div className="kpi-chart">
            <BarList rows={[1, 2, 3].map((t) => ({ key: String(t), label: TIER_LOOK[t].label, value: RECORDS.filter((r) => r.tier === t).length, color: TIER_LOOK[t].color }))} />
          </div>
        </div>
      </div>

      <div className="chart-grid">
        <section className="panel span-7" aria-labelledby="who-open-h">
          <header><h2 id="who-open-h">Ai mở được hồ sơ nào</h2><span className="meta">Theo điều bệnh nhân đồng ý</span></header>
          <DotMatrix
            rows={RECORDS.map((r) => ({ key: r.id, label: <><b>{r.title}</b><span>{r.id} · Tier {r.tier}</span></> }))}
            cols={ACCESS_COLS}
            cell={(id, col) => {
              const r = RECORDS.find((x) => x.id === id)!;
              const color = TIER_LOOK[r.tier].color;
              if (col === "recorder") return { color, tip: `Phòng hồ sơ ghi được ${id} nhưng không đọc lại được`, hollow: true };
              if (col === "clinician" && r.tier === 1) return { color, tip: `Mọi bác sĩ đã xác minh đọc được ${id}` };
              if (col === "jit" && r.tier === 2) return { color, tip: `Một bác sĩ đọc được ${id} khi đủ 2 chữ ký, trong 2 giờ` };
              if (col === "bg" && r.breakGlassEligible) return { color, tip: `Bác sĩ trực mở khẩn cấp được ${id}, có rà soát sau` };
              return null;
            }} />
          <p className="small faint" style={{ marginTop: 10 }}>Ô đặc: được đọc. Ô rỗng: chỉ được ghi.</p>
        </section>
        <section className="panel span-5" aria-labelledby="ct-h">
          <header><h2 id="ct-h">Máy chủ nhận được gì</h2><span className="meta">Ký tự bản mã</span></header>
          {log.some((l) => l.size) ? (
            <BarList unit="" rows={log.filter((l) => l.size).map((l) => ({ key: l.id, label: <span className="mono">{l.id}</span>, value: l.size!, color: "var(--grey)", note: `${l.id}: ký tự bản mã` }))} />
          ) : (
            <p className="small muted">Sau khi nhập hồ sơ, biểu đồ này cho thấy độ dài bản mã máy chủ nhận cho từng hồ sơ. Máy chủ không bao giờ thấy bản rõ.</p>
          )}
        </section>
      </div>

      <div className="setting">
        <div>
          <h2>Bệnh nhân đồng ý những gì</h2>
          <p className="desc">Mỗi điều bệnh nhân đồng ý trở thành một quyền. Quyền chỉ có hiệu lực khi người duyệt ký. Sau khi gửi, Bác sĩ B và C ký ở trang Duyệt yêu cầu.</p>
          <p style={{ marginTop: 16 }}><button className="btn primary" disabled={busy || rows.length > 0} onClick={enroll}>{rows.length ? "Đã gửi cho người duyệt" : "Gửi cho người duyệt"}</button></p>
        </div>
        <div className="panel flush as-list">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Quyền</th><th>Hồ sơ</th><th>Hết hạn</th><th className="n">Trạng thái</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td>{KIND_TEXT[r.spec.kind] ?? r.spec.kind}{r.statusReason && <span className="sub err">{r.statusReason}</span>}</td>
                    <td data-l="Hồ sơ" className="mono">{r.spec.recordId}</td>
                    <td data-l="Hết hạn" className="num">{fmtTime(r.spec.expiry)}</td>
                    <td className="n"><span className={`pill ${r.signed ? "pos" : r.status === "FAILED" ? "neg" : "warn"}`}>{r.signed ? "Đã ký" : r.status === "FAILED" ? "Lỗi" : "Chờ ký"}</span></td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={4} className="muted">Chưa gửi. Bấm "Gửi cho người duyệt" để tạo 6 quyền.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="setting">
        <div>
          <h2>Nhập hồ sơ</h2>
          <p className="desc">Hồ sơ được mã hoá ngay trên trình duyệt này. Phòng hồ sơ chỉ có quyền ghi, nên sau khi nhập cũng không đọc lại được.</p>
          <p style={{ marginTop: 16 }}><button className="btn primary" disabled={busy || !allSigned} onClick={seed}>Nhập {RECORDS.length} hồ sơ mẫu</button></p>
          {!allSigned && rows.length > 0 && <p className="small faint" style={{ marginTop: 8 }}>Chờ ký đủ {rows.length} quyền.</p>}
        </div>
        <div className="panel">
          <div className="rows">
            {RECORDS.map((r) => {
              const l = log.find((x) => x.id === r.id);
              const has = stored.includes(r.id);
              return (
                <div key={r.id} className="row">
                  <span className="grow">{r.title}<span className="line2"><span className="mono">{r.id}</span>{l ? ` · ${l.text}` : ""}</span></span>
                  <span className={`pill ${has ? "pos" : l && !l.ok ? "neg" : ""}`}>{has ? "Đã nhập" : l && !l.ok ? "Lỗi" : "Chưa nhập"}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
