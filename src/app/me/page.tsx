"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useCallback, useEffect, useState } from "react";
import { fmtTime, useApi } from "@/lib/client/api";
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
  records: (RecordMeta & { stored: boolean })[];
  requests: { id: string; recordId: string; doctorUsername: string; reason: string; createdAt: number; expiresAt: number; status: string }[];
  breakGlass: { id: string; recordId: string; doctorUsername: string; reason: string; declaredAt: number; reviewDueAt: number; notified: string[]; status: string; overdue: boolean; reviews: { reviewer: string; decision: string; note: string; at?: number }[] }[];
  standing: { name: string; kind: string; recordId: string; subject: string; access: string; expiry?: number; status: string }[];
  audit: AuditEntry[];
}

const FIELD_TEXT: Record<Tier0Field, string> = {
  bloodType: "Nhóm máu",
  allergies: "Dị ứng",
  medications: "Thuốc đang dùng",
  implants: "Thiết bị cấy ghép",
  emergencyContact: "Người liên hệ",
};
// The patient's log in plain words.
const ACTION_TEXT: Record<string, string> = {
  "record.decrypt": "đọc",
  "record.write": "nhập",
  "patient.lookup": "quét mã QR của bạn",
  "request.create": "xin quyền đọc",
  "request.status": "cập nhật yêu cầu",
  "break-glass.declare": "mở khẩn cấp",
  "break-glass.review": "rà soát lần mở khẩn cấp",
  "grant.file": "gửi quyền cho người duyệt",
  "grant.signed": "quyền được ký",
  "consent.sign": "ký đồng ý",
};
const SUBJECT_TEXT: Record<string, string> = {
  "lifekey-clinician": "Mọi bác sĩ đã xác minh",
  "er-attending": "Bác sĩ trực cấp cứu",
  "lifekey-recorder": "Phòng hồ sơ",
};
const KIND_TEXT: Record<string, string> = {
  "tier1-standing": "được xem",
  "break-glass-standing": "được mở khẩn cấp",
  "recorder-write": "được ghi (không đọc)",
};
const BG_STATUS: Record<string, { text: string; cls: string }> = {
  AWAITING_REVIEW: { text: "Chờ rà soát", cls: "warn" },
  JUSTIFIED: { text: "Hợp lý", cls: "pos" },
  FLAGGED: { text: "Bị gắn cờ", cls: "neg" },
};
const STANDING_SECONDS = 30 * 24 * 3600;
const actor = (u: string) => (u === "lifekey-server" ? "Máy chủ" : u === "patient-alice" ? "Bạn" : displayName(u));

export default function MyRecordPage() {
  const { authenticated, login } = useTideCloak();
  const api = useApi();
  const [data, setData] = useState<MyRecord | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bg, setBg] = useState<string[]>([]);
  const [card, setCard] = useState<Partial<Record<Tier0Field, { show: boolean; value: string }>>>({});
  const [saved, setSaved] = useState<{ version: number; stillSigned: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (!authenticated) {
    return (
      <>
        <div className="title-row"><div><h1>Hồ sơ của tôi</h1><p className="sub">Đăng nhập bằng tài khoản bệnh nhân.</p></div></div>
        <button className="btn primary" onClick={login}>Đăng nhập bằng Tide</button>
      </>
    );
  }
  if (err && !data) return <p className="notice neg">{err === "patients only" ? "Trang này dành cho tài khoản bệnh nhân." : err}</p>;
  if (!data) return <p className="muted">Đang tải…</p>;

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
  const activeReqs = data.requests.filter((r) => r.status === "AUTHORIZED" && r.expiresAt > now);
  const signedStanding = data.standing.filter((s) => s.status === "SIGNED" && s.access === "read");
  const openBg = data.breakGlass.filter((e) => e.status === "AWAITING_REVIEW");
  const changed = !!data.consent && (JSON.stringify([...bg].sort()) !== JSON.stringify([...data.consent.breakGlass].sort())
    || TIER0_FIELDS.some((f) => (card[f]?.show ? card[f]!.value.trim() : "") !== (data.consent!.tier0[f] ?? "")));

  return (
    <>
      <section className="panel" style={{ marginBottom: "var(--gap)" }} aria-label="Bệnh nhân">
        <div className="head" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div className="head">
            <span className="avatar" style={{ width: 56, height: 56, fontSize: 18, background: "var(--green-soft)", color: "var(--green)" }}>AN</span>
            <div>
              <span className="label">Hồ sơ của tôi</span>
              <h1 style={{ fontSize: 24, lineHeight: "30px", fontWeight: 700, letterSpacing: "-0.02em" }}>{data.patient.displayName}</h1>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                <span className="pill">{data.patient.id}</span>
                {data.consent
                  ? <span className="pill pos">Đồng ý phiên bản {data.consent.version} · {fmtTime(data.consent.signedAt)}</span>
                  : <span className="pill warn">Chưa ký đồng ý</span>}
              </div>
            </div>
          </div>
          <button className="btn icon" onClick={load} aria-label="Tải lại"><Icon name="refresh" /></button>
        </div>
      </section>

      {err && <p className="notice neg" style={{ marginBottom: "var(--gap)" }}>{err}</p>}

      <div className="kpis summary" style={{ marginBottom: "var(--gap)" }}>
        <div className="kpi">
          <span className="kpi-label">Lượt đọc hồ sơ của bạn</span>
          <div className="kpi-value">{readsOk.length}<small>lượt · {reads.length - readsOk.length} bị chặn</small></div>
          <div className="kpi-chart">
            <SegBar label="Lượt đọc" parts={[
              { key: "ok", label: "Đọc được", value: readsOk.length, color: "var(--positive)" },
              { key: "bad", label: "Bị chặn", value: reads.length - readsOk.length, color: "var(--negative)" },
            ]} />
          </div>
        </div>
        <div className="kpi">
          <span className="kpi-label">Quyền đang mở</span>
          <div className="kpi-value">{activeReqs.length + signedStanding.length}<small>quyền đọc</small></div>
          <div className="kpi-chart">
            <SegBar label="Quyền đang mở" parts={[
              { key: "standing", label: "Theo vai trò", value: signedStanding.length, color: "var(--teal)" },
              { key: "jit", label: "Cho một bác sĩ", value: activeReqs.length, color: "var(--orange)" },
            ]} />
          </div>
        </div>
        <div className="kpi">
          <span className="kpi-label">Mở khẩn cấp</span>
          <div className="kpi-value">{data.breakGlass.length}<small>lần · {openBg.length} chờ rà soát</small></div>
          <div className="kpi-chart">
            <SegBar label="Mở khẩn cấp" parts={Object.entries(BG_STATUS).map(([k, v]) => ({
              key: k, label: v.text, value: data.breakGlass.filter((e) => e.status === k).length,
              color: k === "JUSTIFIED" ? "var(--positive)" : k === "FLAGGED" ? "var(--negative)" : "var(--warning)",
            }))} />
          </div>
        </div>
      </div>

      <div className="chart-grid">
        <section className="panel span-8" aria-labelledby="act-h">
          <header>
            <h2 id="act-h">Ai đã làm gì với hồ sơ của bạn</h2>
            <span className="legend-inline"><span><i style={{ background: "var(--positive)" }} />Thành công</span><span><i style={{ background: "var(--negative)" }} />Bị từ chối</span></span>
          </header>
          {touching.length ? <Columns buckets={timeBuckets(touching)} label="Việc trên hồ sơ của bạn theo giờ" every={2} /> : <p className="muted">Chưa có ai mở hồ sơ của bạn.</p>}
        </section>
        <section className="panel span-4" aria-labelledby="rec-h">
          <header><h2 id="rec-h">Hồ sơ nào được đọc</h2></header>
          <Donut label="Lượt đọc theo hồ sơ" size={116} parts={byRecord} center={readsOk.length} sub="lượt đọc" />
          <h3 id="who-h" className="small faint" style={{ margin: "18px 0 10px", fontWeight: 500 }}>Ai đọc</h3>
          {byPerson.length ? <BarList rows={byPerson.map(([u, n]) => ({ key: u, label: actor(u), value: n }))} /> : <p className="small muted">Chưa có lượt đọc nào.</p>}
        </section>
        <section className="panel span-12" aria-labelledby="log-h">
          <header><h2 id="log-h">Gần đây</h2><span className="meta">{touching.length} việc</span></header>
          <div className="rows">
            {touching.slice(0, 7).map((e) => (
              <div key={e.seq} className="row">
                <span className="grow">
                  <b style={{ fontWeight: 600 }}>{actor(e.actor)}</b> {ACTION_TEXT[e.action] ?? e.action} {e.resource === data.patient.id ? "" : <span className="mono">{title(e.resource)}</span>}
                  <span className="line2">{fmtTime(e.at)}{e.detail ? ` · ${e.detail.replace(/^client-reported: /, "")}` : ""}</span>
                </span>
                <span className={`pill ${e.outcome === "ok" ? "pos" : e.outcome === "info" ? "" : "neg"}`}>{e.outcome === "ok" ? "Thành công" : e.outcome === "info" ? "Ghi nhận" : "Bị từ chối"}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {data.breakGlass.length > 0 && (
        <section className="sec" style={{ marginBottom: "var(--gap)" }} aria-labelledby="bg-h">
          <div className="title-row" style={{ marginBottom: 12, alignItems: "baseline" }}>
            <h2 id="bg-h" style={{ fontSize: 17, fontWeight: 600 }}>Thông báo mở khẩn cấp</h2>
            <span className="stamp">Bạn được báo mỗi khi có người mở khẩn cấp</span>
          </div>
          <div className="stack">
            {data.breakGlass.map((e) => (
              <div key={e.id} className="panel">
                <header>
                  <div className="head">
                    <IconTile name="bolt" tone="orange" round />
                    <div><span className="label">{displayName(e.doctorUsername)} mở lúc {fmtTime(e.declaredAt)}:</span><span className="value">{title(e.recordId)}</span></div>
                  </div>
                  <span className={`pill ${BG_STATUS[e.status]?.cls ?? ""}`}>{BG_STATUS[e.status]?.text ?? e.status}{e.overdue ? " · quá hạn" : ""}</span>
                </header>
                <p className="muted" style={{ marginBottom: 12 }}>Lý do: {e.reason}</p>
                <div style={{ maxWidth: 720 }}><Timeline label={`Dòng thời gian của ${e.id}`} start={e.declaredAt} end={e.reviewDueAt} now={e.status === "AWAITING_REVIEW" ? now : undefined}
                  marks={[
                    { at: e.declaredAt, text: `${displayName(e.doctorUsername)} mở hồ sơ`, tone: "var(--orange)" },
                    ...e.reviews.filter((r) => r.at).map((r) => ({ at: r.at!, text: `${displayName(r.reviewer)}: ${r.decision === "justified" ? "hợp lý" : "không hợp lý"}`, tone: r.decision === "justified" ? "var(--positive)" : "var(--negative)" })),
                    { at: e.reviewDueAt, text: "Hạn rà soát (72 giờ)", tone: "var(--label)" },
                  ]} /></div>
                <p className="small faint" style={{ marginTop: 8 }}>{e.reviews.length}/2 người đã rà soát. Một ý kiến "không hợp lý" sẽ gắn cờ và đề xuất thu hồi quyền trực của bác sĩ đó.</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="chart-grid">
        <section className="panel span-6" aria-labelledby="open-h">
          <header><h2 id="open-h">Ai đang đọc được hồ sơ của bạn</h2></header>
          <div className="stack" style={{ gap: 14 }}>
            {activeReqs.map((r) => (
              <div key={r.id} className="inset" style={{ display: "grid", gap: 10 }}>
                <span><b style={{ fontWeight: 600 }}>{displayName(r.doctorUsername)}</b> đọc được <b style={{ fontWeight: 600 }}>{title(r.recordId)}</b><span className="small muted" style={{ display: "block" }}>{r.reason}</span></span>
                <TimeLeft issuedAt={r.createdAt} expiresAt={r.expiresAt} />
              </div>
            ))}
            {signedStanding.map((s) => (
              <div key={s.name} style={{ display: "grid", gap: 6 }}>
                <span className="small" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span>{SUBJECT_TEXT[s.subject] ?? s.subject} {KIND_TEXT[s.kind] ?? ""} <b style={{ fontWeight: 600 }}>{title(s.recordId)}</b></span>
                  <span className="faint num">đến {fmtTime(s.expiry)}</span>
                </span>
                {s.expiry && <Meter value={Math.max(0, s.expiry - now)} total={STANDING_SECONDS} label={`Thời hạn còn lại của quyền ${s.recordId}`} />}
              </div>
            ))}
            {data.requests.filter((r) => r.status === "PENDING_APPROVAL").map((r) => (
              <p key={r.id} className="small"><span className="pill warn">{STATUS_TEXT[r.status]}</span> {displayName(r.doctorUsername)} xin đọc {title(r.recordId)}</p>
            ))}
            {!activeReqs.length && !signedStanding.length && <p className="small muted">Chưa ai có quyền đọc hồ sơ của bạn.</p>}
            <p className="small faint">Thanh dưới mỗi quyền theo vai trò là thời hạn còn lại trong 30 ngày. Hết hạn thì người duyệt phải ký lại.</p>
          </div>
        </section>

        <section className="panel span-6" aria-labelledby="card-h">
          <header><h2 id="card-h">Thẻ khẩn cấp</h2><span className="meta">Ai cầm thẻ cũng đọc được</span></header>
          <div className="emergency-card">
            <div className="ec-head"><b>LifeKey · Thẻ khẩn cấp</b><span>{data.patient.displayName}</span></div>
            <dl>
              {TIER0_FIELDS.filter((f) => card[f]?.show && card[f]?.value.trim()).map((f) => (
                <div key={f}><dt>{FIELD_TEXT[f]}</dt><dd>{card[f]!.value}</dd></div>
              ))}
            </dl>
            {!TIER0_FIELDS.some((f) => card[f]?.show && card[f]?.value.trim()) && <p className="small">Thẻ chưa hiện thông tin nào ngoài mã QR.</p>}
            <PatientQR publicId={data.patient.publicId} />
          </div>
          <p className="small faint" style={{ marginTop: 10 }}>Thẻ không mã hoá, giống Medical ID trên điện thoại. Mã QR chỉ dẫn tới hồ sơ, không chứa dữ liệu y tế.</p>
        </section>
      </div>

      <section className="panel" aria-labelledby="consent-h">
        <header>
          <h2 id="consent-h">Đồng ý của tôi</h2>
          <span className="meta">{data.consent ? `Phiên bản ${data.consent.version}, ký lúc ${fmtTime(data.consent.signedAt)}` : "Chưa ký"}</span>
        </header>
        <div className="consent-grid">
          <fieldset>
            <legend>Bác sĩ trực cấp cứu được mở ngay hồ sơ nào</legend>
            <ul className="rows">
              {data.records.map((r) => (
                <li key={r.id} className="row">
                  <IconTile name={r.tier === 3 ? "lock" : r.tier === 1 ? "heart" : "file"} tone={r.tier === 3 ? "grey" : r.tier === 1 ? "pink" : "teal"} sm />
                  <span className="grow">{r.title}<span className="line2">{r.id} · {r.tier === 1 ? "Mọi bác sĩ đã xác minh luôn xem được" : r.tier === 3 ? "Không bao giờ mở khi cấp cứu" : "Bình thường cần 2 người duyệt"}</span></span>
                  {r.tier === 2 ? (
                    <label className="switch">
                      <input type="checkbox" id={`bg-${r.id}`} checked={bg.includes(r.id)} onChange={(e) => setBg((x) => e.target.checked ? [...x, r.id] : x.filter((y) => y !== r.id))} />
                      <span>Cho mở khẩn cấp</span>
                    </label>
                  ) : <span className="small faint">{r.tier === 1 ? "Luôn hiện" : "Khoá"}</span>}
                </li>
              ))}
            </ul>
          </fieldset>
          <fieldset>
            <legend>Thẻ khẩn cấp hiện gì</legend>
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
            {data.consent ? `Ký phiên bản ${data.consent.version + 1}` : "Ký đồng ý"}
          </button>
          <span className="small muted">{data.consent && !changed ? "Chưa có thay đổi." : "Bạn ký bằng tài khoản Tide của mình. Phòng hồ sơ chỉ gửi quyền mà bạn đã đồng ý."}</span>
        </div>
        {saved && (
          <p className="notice acc" style={{ marginTop: 14 }}>
            Đã ký phiên bản {saved.version}.
            {saved.stillSigned.length > 0 && ` LifeKey ngừng cho mở khẩn cấp ${saved.stillSigned.join(", ")} ngay. Quyền đã ký trên mạng Tide vẫn còn tới khi hết hạn, vì mạng chưa thu hồi được từng quyền.`}
          </p>
        )}
        <p className="small faint" style={{ marginTop: 14 }}>
          Đồng ý này do LifeKey kiểm soát: LifeKey chỉ gửi những quyền bạn cho phép, và người duyệt vẫn phải ký từng quyền. Mạng Tide chưa tự kiểm tra chữ ký của bạn; việc đó cần một hợp đồng Forseti riêng do Tide triển khai.
        </p>
      </section>
    </>
  );
}
