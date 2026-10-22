"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { RecordMeta, SafetyAlert } from "@/lib/lifekey/catalogue";
import { decryptRecord, fmtTime, networkReason, useApi } from "@/lib/client/api";
import { GrantCard, STATUS_TEXT } from "../../GrantCard";
import { SegBar, SituationMatrix } from "../../charts";
import { Icon, IconTile, PatientQR, Ring } from "../../ui";

interface PatientView {
  patient: { id: string; publicId: string; displayName: string };
  records: (RecordMeta & { ciphertext: string | null })[];
}
interface Tier1 {
  bloodType: string;
  alerts: SafetyAlert[];
  dataStatus: Record<string, string>;
  emergencyContact: string;
}
interface Req {
  id: string;
  recordId: string;
  status: string;
  statusReason?: string;
  createdAt: number;
  expiresAt: number;
  reason: string;
  doctorUsername: string;
}

const VERIFY_TEXT: Record<string, string> = {
  clinician_verified: "bác sĩ đã xác minh",
  patient_reported: "bệnh nhân tự khai",
  unverified: "chưa xác minh",
  no_data: "chưa có dữ liệu",
};
const FIELD_TEXT: Record<string, string> = { allergies: "Dị ứng", medications: "Thuốc", implants: "Thiết bị cấy ghép", pregnancy: "Thai kỳ" };
const ALERT_LOOK: Record<string, { icon: string; tone: "pink" | "orange" | "teal" | "green" | "grey"; label: string }> = {
  high_risk_medication: { icon: "pill", tone: "orange", label: "Thuốc nguy cơ cao" },
  allergy: { icon: "allergy", tone: "pink", label: "Dị ứng" },
  implant: { icon: "heart", tone: "teal", label: "Thiết bị cấy ghép" },
  condition: { icon: "heart", tone: "green", label: "Bệnh lý" },
  restricted_record: { icon: "lock", tone: "grey", label: "Hồ sơ hạn chế" },
};
const TONE_COLOR: Record<string, string> = { pink: "var(--pink)", orange: "var(--orange)", teal: "var(--teal)", green: "var(--green)", grey: "var(--grey)" };
const ACCESS_LOOK = {
  read: { label: "Đọc được", color: "var(--positive)" },
  pending: { label: "Chờ duyệt", color: "var(--warning)" },
  none: { label: "Chưa có quyền", color: "var(--control)" },
  restricted: { label: "Hạn chế", color: "var(--grey)", hatched: true },
} as const;

export default function EmergencyPage() {
  const { publicId } = useParams<{ publicId: string }>();
  const { authenticated, hasRealmRole, login } = useTideCloak();
  const api = useApi();
  const [view, setView] = useState<PatientView | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [tier1, setTier1] = useState<Tier1 | null>(null);
  const [tier1Error, setTier1Error] = useState<string | null>(null);
  const [requests, setRequests] = useState<Req[]>([]);
  const [opened, setOpened] = useState<Record<string, { text?: string; error?: string; via?: string }>>({});
  const [dialog, setDialog] = useState<{ mode: "request" | "break-glass"; record: RecordMeta; alertId?: string } | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const report = (resource: string, ok: boolean, detail: string) =>
    api("/api/audit", { method: "POST", body: { action: "record.decrypt", resource, outcome: ok ? "ok" : "denied", detail } }).catch(() => undefined);

  const load = useCallback(async () => {
    try {
      const v = await api<PatientView>(`/api/patients/${publicId}`);
      setView(v);
      const t1 = v.records.find((r) => r.tier === 1);
      if (t1?.ciphertext) {
        try {
          const { policy } = await api<{ policy: string }>(`/api/policies?purpose=tier1&record=${t1.id}`);
          setTier1(JSON.parse(await decryptRecord(t1.ciphertext, t1.id, policy)));
          setTier1Error(null);
          report(t1.id, true, "Tier 1");
        } catch (e) {
          setTier1Error(networkReason(e));
          report(t1.id, false, networkReason(e));
        }
      } else {
        setTier1Error("Bệnh nhân này chưa có bản tóm tắt cấp cứu.");
      }
      const r = await api<{ requests: Req[] }>("/api/emergency-requests");
      setRequests(r.requests);
      setLoadedAt(Math.floor(Date.now() / 1000));
    } catch (e) {
      const err = e as Error & { status?: number; body?: { message?: string } };
      if (err.status === 404) setNotFound(err.body?.message ?? "No previous medical records available");
      else setMsg({ kind: "err", text: err.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, publicId]);

  useEffect(() => {
    if (authenticated) load();
  }, [authenticated, load]);

  async function openRecord(record: RecordMeta, via: "request" | "break-glass", requestId?: string) {
    const ct = view?.records.find((r) => r.id === record.id)?.ciphertext;
    if (!ct) return setOpened((o) => ({ ...o, [record.id]: { error: "Hồ sơ này chưa được nhập." } }));
    try {
      const q = via === "request" ? `purpose=request&record=${record.id}&request=${requestId}` : `purpose=break-glass&record=${record.id}`;
      const { policy } = await api<{ policy: string }>(`/api/policies?${q}`);
      const text = await decryptRecord(ct, record.id, policy);
      setOpened((o) => ({ ...o, [record.id]: { text, via } }));
      report(record.id, true, `via ${via}${requestId ? ` ${requestId}` : ""}`);
    } catch (e) {
      setOpened((o) => ({ ...o, [record.id]: { error: networkReason(e), via } }));
      report(record.id, false, `via ${via}: ${networkReason(e)}`);
    }
  }

  async function submitDialog() {
    if (!dialog || !view) return;
    setBusy(true);
    setMsg(null);
    try {
      if (dialog.mode === "request") {
        const r = await api<{ request: Req }>("/api/emergency-requests", {
          method: "POST",
          body: { patientId: view.patient.id, recordId: dialog.record.id, alertId: dialog.alertId, reason },
        });
        setMsg({ kind: "ok", text: `Đã gửi ${r.request.id}. Hồ sơ mở được khi đủ 2 người duyệt ký.` });
      } else {
        await api("/api/break-glass", { method: "POST", body: { patientId: view.patient.id, recordId: dialog.record.id, reason } });
        await openRecord(dialog.record, "break-glass");
        setMsg({ kind: "ok", text: `Đã mở ${dialog.record.id}. Bệnh nhân, người liên hệ và người duyệt trực đã được báo.` });
      }
      setDialog(null);
      setReason("");
      await load();
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!authenticated) {
    return (
      <>
        <div className="title-row"><div><h1>Hồ sơ bệnh nhân</h1><p className="sub">Đăng nhập để xem. Mã QR chỉ chứa <span className="mono">{publicId}</span>, không chứa dữ liệu y tế hay khoá.</p></div></div>
        <button className="btn primary" onClick={login}>Đăng nhập bằng Tide</button>
      </>
    );
  }
  if (notFound) {
    return (
      <>
        <div className="title-row"><div><h1>Không có hồ sơ</h1><p className="sub">Không tìm thấy bệnh nhân với mã <span className="mono">{publicId}</span>.</p></div></div>
        <div className="empty">Bệnh nhân chưa có hồ sơ trên LifeKey. Hãy tạo hồ sơ cấp cứu tạm tại khoa và không suy đoán tiền sử.</div>
      </>
    );
  }
  if (!view) return <p className="muted">Đang tải…</p>;

  const erAttending = hasRealmRole("er-attending");
  const records = view.records.filter((r) => r.tier !== 1);
  const recordTitle = (id: string) => view.records.find((r) => r.id === id)?.title;
  const verified = tier1?.alerts.filter((a) => a.category !== "restricted_record").length ?? 0;
  const access = (r: RecordMeta): keyof typeof ACCESS_LOOK => {
    const mine = requests.filter((q) => q.recordId === r.id);
    if (mine.some((q) => q.status === "AUTHORIZED")) return "read";
    if (mine.some((q) => q.status === "PENDING_APPROVAL")) return "pending";
    return r.tier === 3 ? "restricted" : "none";
  };
  const accessCounts = records.reduce<Record<string, number>>((m, r) => ({ ...m, [access(r)]: (m[access(r)] ?? 0) + 1 }), {});
  const alertKinds = Object.keys(ALERT_LOOK).map((k) => ({
    key: k, label: ALERT_LOOK[k].label, color: TONE_COLOR[ALERT_LOOK[k].tone], hatched: k === "restricted_record",
    value: tier1?.alerts.filter((a) => a.category === k).length ?? 0,
  }));
  const fields = tier1 ? Object.values(tier1.dataStatus) : [];
  const fieldsVerified = fields.filter((v) => v === "clinician_verified").length;
  const missing = tier1 ? Object.entries(tier1.dataStatus).filter(([, v]) => v === "no_data").map(([k]) => FIELD_TEXT[k] ?? k) : [];

  return (
    <>
      <section className="panel" style={{ marginBottom: "var(--gap)" }} aria-label="Bệnh nhân">
        <div className="head" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div className="head">
            <span className="avatar" style={{ width: 56, height: 56, fontSize: 18, background: "var(--teal-soft)", color: "var(--teal)" }}>AN</span>
            <div>
              <span className="label">Bệnh nhân</span>
              <h1 style={{ fontSize: 24, lineHeight: "30px", fontWeight: 700, letterSpacing: "-0.02em" }}>{view.patient.displayName}</h1>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                <span className="pill">{view.patient.id}</span>
                {tier1 && <span className="pill gold">Nhóm máu {tier1.bloodType}</span>}
                {tier1 && <span className="pill neg">{verified} cảnh báo</span>}
              </div>
            </div>
          </div>
          <div className="title-row" style={{ margin: 0, alignItems: "center" }}>
            <span className="stamp">{loadedAt ? `Cập nhật ${fmtTime(loadedAt)}` : ""}</span>
            <button className="btn icon" onClick={load} aria-label="Tải lại"><Icon name="refresh" /></button>
          </div>
        </div>
      </section>

      {tier1 && (
        <div className="kpis summary" style={{ marginBottom: "var(--gap)" }}>
          <div className="kpi">
            <span className="kpi-label">Cảnh báo theo loại</span>
            <div className="kpi-value">{verified}<small>cảnh báo{alertKinds.find((k) => k.key === "restricted_record")?.value ? " + 1 hạn chế" : ""}</small></div>
            <div className="kpi-chart"><SegBar label="Cảnh báo theo loại" parts={alertKinds} /></div>
          </div>
          <div className="kpi">
            <span className="kpi-label">Dữ liệu cấp cứu</span>
            <div className="chart-row">
              <Ring value={fieldsVerified} total={fields.length} icon="shield" size={60} />
              <div>
                <div className="kpi-value" style={{ marginTop: 0 }}>{fieldsVerified}/{fields.length}<small>đã xác minh</small></div>
                <span className="small faint">{missing.length ? `Chưa có dữ liệu: ${missing.join(", ")}` : "Đủ mọi mục"}</span>
              </div>
            </div>
          </div>
          <div className="kpi">
            <span className="kpi-label">Quyền đọc hồ sơ chi tiết</span>
            <div className="kpi-value">{accessCounts.read ?? 0}/{records.length}<small>đọc được</small></div>
            <div className="kpi-chart">
              <SegBar label="Quyền đọc hồ sơ chi tiết" parts={(Object.keys(ACCESS_LOOK) as (keyof typeof ACCESS_LOOK)[]).map((k) => ({
                key: k, label: ACCESS_LOOK[k].label, color: ACCESS_LOOK[k].color, hatched: "hatched" in ACCESS_LOOK[k], value: accessCounts[k] ?? 0,
              }))} />
            </div>
          </div>
        </div>
      )}

      {msg && <p className={`notice ${msg.kind === "err" ? "neg" : "acc"}`} style={{ marginBottom: "var(--gap)" }}>{msg.text}</p>}

      <div className="grid">
        <div className="stack span-8">
          <section className="panel" aria-labelledby="alerts-h">
            <header>
              <h2 id="alerts-h">Cảnh báo cấp cứu</h2>
              <span className="meta">Mọi bác sĩ đã xác minh đều thấy</span>
            </header>
            {tier1Error && <p className="notice neg">Không mở được bản tóm tắt: {tier1Error}</p>}
            {tier1?.alerts.map((a) => {
              const src = view.records.find((r) => r.id === a.sourceRecordId);
              const look = ALERT_LOOK[a.category] ?? ALERT_LOOK.restricted_record;
              return (
                <div key={a.id} className="alert-row">
                  <IconTile name={look.icon} tone={look.tone} />
                  <div>
                    <p className="msg">{a.message}</p>
                    <span className="src">{look.label} · {VERIFY_TEXT[a.verificationStatus]}{a.verifiedAt ? ` ${fmtTime(Date.parse(a.verifiedAt) / 1000)}` : ""} · nguồn {a.sourceRecordId}</span>
                  </div>
                  {src?.tier === 2 ? (
                    <button className="link" onClick={() => setDialog({ mode: "request", record: src, alertId: a.id })}>Xem hồ sơ gốc</button>
                  ) : (
                    <span className="small faint">Không mở khi cấp cứu</span>
                  )}
                </div>
              );
            })}
          </section>

          {tier1 && tier1.alerts.length > 0 && (
            <section className="panel" aria-labelledby="situ-h">
              <header>
                <h2 id="situ-h">Cảnh báo theo tình huống</h2>
                <span className="meta">Trước khi làm gì, xem cột đó</span>
              </header>
              <SituationMatrix rows={tier1.alerts.map((a) => {
                const look = ALERT_LOOK[a.category] ?? ALERT_LOOK.restricted_record;
                return { id: a.id, label: look.label, sub: `${a.id} · ${a.sourceRecordId}`, color: TONE_COLOR[look.tone], tags: a.contextTags };
              })} />
            </section>
          )}

          {dialog && (
            <section className="panel" aria-labelledby="dialog-h">
              <header>
                <div className="head">
                  <IconTile name={dialog.mode === "break-glass" ? "bolt" : "key"} tone={dialog.mode === "break-glass" ? "orange" : "teal"} round />
                  <div>
                    <span className="label">{dialog.mode === "break-glass" ? "Mở khẩn cấp:" : "Xin quyền đọc:"}</span>
                    <span className="value" id="dialog-h">{dialog.record.title}</span>
                  </div>
                </div>
                <button className="btn ghost icon" onClick={() => setDialog(null)} aria-label="Huỷ"><Icon name="close" /></button>
              </header>
              <div className="field">
                <label htmlFor="reason">Lý do lâm sàng</label>
                <textarea id="reason" className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder={dialog.mode === "break-glass" ? "Ví dụ: bất tỉnh, đang chảy máu, cần biết thuốc chống đông" : "Ví dụ: đánh giá nguy cơ chảy máu trước khi khâu"} />
              </div>
              <ul className="checks" style={{ margin: "16px 0" }}>
                {dialog.mode === "break-glass" ? (
                  <>
                    <li><Icon name="tick" />Mở ngay, không cần chờ ai duyệt</li>
                    <li><Icon name="tick" />Bệnh nhân, người liên hệ và người duyệt trực được báo</li>
                    <li><Icon name="tick" />Hai người duyệt rà soát trong 72 giờ</li>
                  </>
                ) : (
                  <>
                    <li><Icon name="tick" />Chỉ bạn đọc được, chỉ hồ sơ {dialog.record.id}</li>
                    <li><Icon name="tick" />Chỉ đọc, tự hết hạn sau 2 giờ</li>
                    <li><Icon name="tick" />Có hiệu lực khi 2 người duyệt ký</li>
                  </>
                )}
              </ul>
              <button className="btn primary block" disabled={busy} onClick={submitDialog}>{dialog.mode === "break-glass" ? "Mở hồ sơ ngay" : "Gửi yêu cầu"}</button>
            </section>
          )}

          <section aria-labelledby="records-h">
            <div className="title-row" style={{ marginBottom: 12, alignItems: "baseline" }}>
              <h2 id="records-h" style={{ fontSize: 17, fontWeight: 600 }}>Hồ sơ chi tiết</h2>
              <span className="stamp">Mỗi hồ sơ cần quyền đọc riêng</span>
            </div>
            <div className="cards">
              {records.map((r) => {
                const mine = requests.filter((q) => q.recordId === r.id);
                const auth = mine.find((q) => q.status === "AUTHORIZED");
                const pending = mine.find((q) => q.status === "PENDING_APPROVAL");
                const latest = mine[0];
                return (
                  <div key={r.id} className="panel rec">
                    <div className="top">
                      <IconTile name={r.tier === 3 ? "lock" : r.category === "medications" ? "pill" : "file"} tone={r.tier === 3 ? "grey" : r.category === "medications" ? "orange" : "green"} />
                      {auth ? <span className="pill pos">Đọc được</span>
                        : pending ? <span className="pill warn">Chờ duyệt</span>
                        : latest ? <span className="pill">{STATUS_TEXT[latest.status] ?? latest.status}</span>
                        : r.tier === 3 ? <span className="pill">Hạn chế</span> : null}
                    </div>
                    <div>
                      <b style={{ fontWeight: 600, fontSize: 15 }}>{r.title}</b>
                      <span className="small muted" style={{ display: "block" }}>{r.id}</span>
                    </div>
                    <ul className="checks small">
                      {r.tier === 2 ? <li><Icon name="tick" />Cần 2 người duyệt</li> : <li className="off"><Icon name="x" />Không mở khi cấp cứu</li>}
                      {r.breakGlassEligible ? <li><Icon name="tick" />Bệnh nhân cho mở khẩn cấp</li> : <li className="off"><Icon name="x" />Không mở khẩn cấp</li>}
                      {auth && <li><Icon name="clock" />Đến {fmtTime(auth.expiresAt)}</li>}
                    </ul>
                    <div className="actions">
                    {auth && <button className="btn primary block" onClick={() => openRecord(r, "request", auth.id)}>Đọc hồ sơ</button>}
                    {r.tier === 2 && !auth && !pending && <button className="btn soft block" onClick={() => setDialog({ mode: "request", record: r })}>Xin quyền đọc</button>}
                    {r.tier === 2 && pending && <button className="btn soft block" disabled>Đang chờ duyệt</button>}
                    {r.tier === 2 && r.breakGlassEligible && erAttending && !auth && <button className="btn block" onClick={() => setDialog({ mode: "break-glass", record: r })}>Mở khẩn cấp</button>}
                    {r.tier === 3 && <button className="btn soft block" disabled>Cần căn cứ pháp lý riêng</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {Object.entries(opened).map(([id, o]) => (
            <section key={id} className="panel">
              <header>
                <div className="head">
                  <IconTile name="file" tone={o.text ? "green" : "grey"} round />
                  <div><span className="label">{id}</span><span className="value">{recordTitle(id)}</span></div>
                </div>
                <span className={`pill ${o.text ? "pos" : "neg"}`}>{o.text ? (o.via === "break-glass" ? "Mở khẩn cấp" : "Đã mở") : "Bị từ chối"}</span>
              </header>
              {o.text ? <pre className="record">{JSON.stringify(JSON.parse(o.text), null, 2)}</pre> : <p className="notice neg">{o.error}</p>}
            </section>
          ))}
        </div>

        <div className="stack span-4">
          <section className="panel" aria-labelledby="qr-h">
            <div className="head" style={{ marginBottom: 14 }}>
              <IconTile name="patient" tone="teal" round />
              <div><span className="label">Mã QR bệnh nhân:</span><span className="value" id="qr-h">Thẻ cấp cứu</span></div>
            </div>
            <PatientQR publicId={view.patient.publicId} />
            <div className="check-line"><i aria-hidden="true" /><span className="small">Mã chỉ dẫn tới hồ sơ, không chứa dữ liệu y tế hay khoá</span></div>
          </section>

          <section className="panel" aria-labelledby="facts-h">
            <header><h2 id="facts-h">Thông tin nhanh</h2></header>
            {tier1 ? (
              <dl className="kv">
                {Object.entries(tier1.dataStatus).map(([k, v]) => (
                  <div key={k}><dt>{FIELD_TEXT[k] ?? k}:</dt><dd className={v === "no_data" ? "faint" : ""}><span className={`st${v === "clinician_verified" ? "" : " none"}`}>{VERIFY_TEXT[v] ?? v}</span></dd></div>
                ))}
                <div className="stacked"><dt>Người liên hệ:</dt><dd>{tier1.emergencyContact}</dd></div>
              </dl>
            ) : <p className="muted">—</p>}
            <p className="small faint" style={{ marginTop: 10 }}>Chưa có dữ liệu không có nghĩa là không có nguy cơ.</p>
          </section>

          {requests.slice(0, 2).map((q) => (
            <section key={q.id} className="panel">
              <GrantCard doctor={q.doctorUsername} recordId={q.recordId} recordTitle={recordTitle(q.recordId)} expiresAt={q.expiresAt} issuedAt={q.createdAt} signed={q.status === "AUTHORIZED" ? 2 : 0} needed={2} status={q.status} />
              {q.statusReason && <p className="small err" style={{ marginTop: 8 }}>{q.statusReason}</p>}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
