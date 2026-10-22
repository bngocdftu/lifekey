"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useCallback, useEffect, useState } from "react";
import { PATIENT, RECORDS, SYNTHETIC_PLAINTEXT } from "@/lib/lifekey/catalogue";
import { encryptRecord, fmtTime, networkReason, useApi } from "@/lib/client/api";

interface PolicyRow {
  name: string;
  spec: { kind: string; recordId: string; subject: { type: string; id: string }; access: string; expiry?: number };
  changeRequestId?: string;
  status: string;
  statusReason?: string;
  signed: boolean;
}

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
  const [log, setLog] = useState<{ id: string; ok: boolean; text: string }[]>([]);
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
        out.push({ id: r.id, ok: true, text: `Đã mã hoá trên máy này, máy chủ chỉ nhận ${ciphertext.length.toLocaleString("vi-VN")} ký tự mã hoá.` });
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

      <div className="kpis" style={{ marginBottom: 8 }}>
        <div className="kpi"><div className="kpi-label">Quyền đã ký</div><div className="kpi-value">{signed}<small>/ {rows.length || 6}</small></div></div>
        <div className="kpi"><div className="kpi-label">Hồ sơ đã nhập</div><div className="kpi-value">{stored.length}<small>/ {RECORDS.length}</small></div></div>
        <div className="kpi"><div className="kpi-label">Hồ sơ cho mở khẩn cấp</div><div className="kpi-value">{RECORDS.filter((r) => r.breakGlassEligible).length}</div></div>
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
