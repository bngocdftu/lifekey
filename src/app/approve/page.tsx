"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useCallback, useEffect, useState } from "react";
import { fmtTime, useApi } from "@/lib/client/api";
import { approveChangeRequests, denyChangeRequest, type ApproveResult } from "@/lib/client/approve";
import { displayName, initials, personTint } from "../AppShell";
import { Icon, IconTile } from "../ui";
import { GrantCard } from "../GrantCard";

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
  request?: { id: string; reason: string; alertId?: string; doctorUsername: string; createdAt: number; digest: string };
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
  reviews: { reviewer: string; decision: string; note: string }[];
}

// Standing grants are written the way an approver would say them.
const KIND_TEXT: Record<string, string> = {
  "emergency-jit": "Xin quyền đọc",
  "tier1-standing": "Bác sĩ đã xác minh xem cảnh báo cấp cứu",
  "recorder-write": "Phòng hồ sơ được ghi (không được đọc)",
  "break-glass-standing": "Bác sĩ trực được mở khẩn cấp",
};
const SUBJECT_TEXT: Record<string, string> = {
  "lifekey-clinician": "Mọi bác sĩ đã xác minh",
  "lifekey-recorder": "Phòng hồ sơ",
  "er-attending": "Bác sĩ trực cấp cứu",
};
const NOTIFIED_TEXT: Record<string, string> = {
  patient: "Bệnh nhân",
  "emergency-contact": "Người liên hệ",
  "on-call-approvers": "Người duyệt trực",
  "privacy-officer": "Bộ phận bảo mật",
};
const BG_STATUS: Record<string, { text: string; cls: string }> = {
  AWAITING_REVIEW: { text: "Chờ rà soát", cls: "warn" },
  JUSTIFIED: { text: "Hợp lý", cls: "pos" },
  FLAGGED: { text: "Bị gắn cờ", cls: "neg" },
};

function since(t: number) {
  const m = Math.round((Date.now() / 1000 - t) / 60);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} giờ` : `${Math.round(h / 24)} ngày`;
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
        <div className="title-row"><div><h1>Duyệt yêu cầu</h1><p className="sub">Đăng nhập bằng tài khoản người duyệt (Bác sĩ B hoặc C).</p></div></div>
        <button className="btn primary" onClick={login}>Đăng nhập bằng Tide</button>
      </>
    );
  }

  const openReviews = events.filter((e) => e.status === "AWAITING_REVIEW");
  const signable = items.filter((i) => !i.blockedReason && !i.changeRequest?.authorizers?.some((a) => a.username === me));
  const sel = tab === "requests" ? items.find((i) => i.changeRequestId === selected) : undefined;
  const selBg = tab === "reviews" ? events.find((e) => e.id === selected) : undefined;
  const result = sel ? results.find((r) => r.id === sel.changeRequestId) : undefined;

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Duyệt yêu cầu</h1>
          <p className="sub">
            {loaded ? (
              items.length || openReviews.length ? (
                <><b>{items.length} yêu cầu</b> chờ chữ ký, <b>{openReviews.length} lần mở khẩn cấp</b> chờ rà soát.</>
              ) : "Không có gì chờ bạn."
            ) : "Đang tải…"}
          </p>
        </div>
        <div className="actions">
          {tab === "requests" && signable.length > 1 && (
            <button className="btn primary" disabled={busy} onClick={() => approve(signable.map((i) => i.changeRequestId))}>Ký cả {signable.length} mục</button>
          )}
          <button className="btn" onClick={load}>Tải lại</button>
        </div>
      </div>

      {err && <p className="notice neg" style={{ marginBottom: 24 }}>{err}</p>}

      <div className="inbox" data-open={selected ? "true" : "false"}>
        <div className="inbox-side">
          <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
            <button role="tab" aria-selected={tab === "requests"} onClick={() => { setTab("requests"); setSelected(null); }}>Chờ ký<span className="count">{items.length}</span></button>
            <button role="tab" aria-selected={tab === "reviews"} onClick={() => { setTab("reviews"); setSelected(null); }}>Mở khẩn cấp<span className="count">{openReviews.length}</span></button>
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
                    <span className="small faint">{it.request ? since(it.request.createdAt) : "đăng ký"}</span>
                  </span>
                  <span className="l2">{it.request ? it.request.reason : KIND_TEXT[it.kind]} · <span className="mono">{it.recordId}</span></span>
                  <span className="small faint">{it.changeRequest?.authorizationCount ?? 0}/{it.changeRequest?.threshold ?? 2} chữ ký{signed ? " · bạn đã ký" : ""}</span>
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
                <span className="small" style={{ color: e.overdue ? "var(--negative)" : "var(--faint)" }}>{BG_STATUS[e.status]?.text}{e.overdue ? " · quá hạn" : ""}</span>
              </button>
            ))}
            {((tab === "requests" && !items.length) || (tab === "reviews" && !events.length)) && (
              <p className="small muted" style={{ padding: 14 }}>{tab === "requests" ? "Không có yêu cầu nào chờ ký." : "Chưa có lần mở khẩn cấp nào."}</p>
            )}
          </div>
        </div>

        <div className="inbox-detail">
          <button className="btn ghost back" onClick={() => setSelected(null)}><Icon name="back" />Danh sách</button>

          {!sel && !selBg && (
            <div className="empty">Chọn một mục bên trái để xem chi tiết.</div>
          )}

          {sel && (
            <div className="stack">
              <div className="panel">
                <header>
                  <h2>{sel.request ? `Yêu cầu của ${displayName(sel.request.doctorUsername)}` : KIND_TEXT[sel.kind]}</h2>
                  {sel.request && <span className="meta mono">{sel.request.id}</span>}
                </header>
                <GrantCard
                  doctor={sel.subject.type === "User" ? sel.subject.username ?? "?" : SUBJECT_TEXT[sel.subject.id ?? ""] ?? sel.subject.id ?? ""}
                  verb={sel.roles.includes("_tide_decryptor") ? "Quyền đọc" : "Quyền ghi"}
                  person={sel.subject.type === "User"}
                  recordId={sel.recordId}
                  recordTitle={sel.recordTitle}
                  expiresAt={sel.expiry}
                  signed={sel.changeRequest?.authorizationCount ?? 0}
                  needed={sel.changeRequest?.threshold ?? 2}
                  signers={sel.changeRequest?.authorizers?.map((a) => a.username)}
                />
                <dl className="kv" style={{ marginTop: 16 }}>
                  <div><dt>Quyền:</dt><dd>{sel.roles.includes("_tide_decryptor") ? "Chỉ đọc" : "Chỉ ghi"}</dd></div>
                  {sel.request && <div><dt>Lý do:</dt><dd>{sel.request.reason}</dd></div>}
                  {sel.request?.alertId && <div><dt>Từ cảnh báo:</dt><dd className="mono">{sel.request.alertId}</dd></div>}
                </dl>
                {sel.blockedReason && <p className="notice neg" style={{ marginTop: 16 }}>{sel.blockedReason === "the requesting doctor cannot approve their own request" ? "Bạn là người gửi yêu cầu này nên không được tự duyệt." : sel.blockedReason}</p>}
                <div className="row" style={{ borderTop: 0, paddingBottom: 0, flexWrap: "wrap", gap: 8 }}>
                  <button className="btn primary" disabled={busy || !!sel.blockedReason || !!sel.changeRequest?.authorizers?.some((a) => a.username === me)} onClick={() => approve([sel.changeRequestId])}>
                    {sel.changeRequest?.authorizers?.some((a) => a.username === me) ? "Bạn đã ký" : "Ký duyệt"}
                  </button>
                  <button className="btn danger" disabled={busy} onClick={() => deny(sel.changeRequestId)}>Từ chối</button>
                </div>
                {result && (
                  <p className="small muted" style={{ marginTop: 12 }}>
                    {result.outcome === "recorded" ? (result.committed ? "Đủ chữ ký. Quyền đọc đã có hiệu lực." : `Đã ghi chữ ký của bạn (${result.authCount ?? "?"}/${result.threshold ?? "?"}).`) : result.outcome === "denied" ? "Bạn đã huỷ trong cửa sổ Tide." : `Lỗi: ${result.message}`}
                  </p>
                )}
              </div>
              <p className="small faint">Bạn ký bằng Tide trên máy của mình, gửi thẳng tới TideCloak. Máy chủ LifeKey không ký thay được.</p>
            </div>
          )}

          {selBg && (
            <div className="panel">
              <header>
                <div className="head">
                  <IconTile name="bolt" tone="orange" round />
                  <div><span className="label">Mở khẩn cấp:</span><span className="value">{selBg.recordId}</span></div>
                </div>
                <span className={`pill ${BG_STATUS[selBg.status]?.cls}`}>{BG_STATUS[selBg.status]?.text}</span>
              </header>
              <dl className="kv">
                <div><dt>Bác sĩ:</dt><dd><span className="avatar" style={{ ...personTint(selBg.doctorUsername), display: "inline-grid", width: 20, height: 20, fontSize: 11, marginRight: 6, verticalAlign: "middle" }}>{initials(selBg.doctorUsername)}</span>{displayName(selBg.doctorUsername)}</dd></div>
                <div><dt>Lúc:</dt><dd className="num">{fmtTime(selBg.declaredAt)}</dd></div>
                <div><dt>Lý do:</dt><dd>{selBg.reason}</dd></div>
                <div><dt>Đã báo:</dt><dd>{selBg.notified.map((n) => NOTIFIED_TEXT[n] ?? n).join(", ")}</dd></div>
                <div><dt>Hạn rà soát:</dt><dd className="num" style={{ color: selBg.overdue ? "var(--negative)" : undefined }}>{fmtTime(selBg.reviewDueAt)}</dd></div>
              </dl>
              {selBg.reviews.length > 0 && (
                <div className="rows" style={{ marginTop: 12 }}>
                  {selBg.reviews.map((r) => (
                    <div key={r.reviewer} className="row">
                      <span className="grow">{displayName(r.reviewer)}<span className="line2">{r.note}</span></span>
                      <span className={`pill ${r.decision === "justified" ? "pos" : "neg"}`}>{r.decision === "justified" ? "Hợp lý" : "Không hợp lý"}</span>
                    </div>
                  ))}
                </div>
              )}
              {selBg.status === "AWAITING_REVIEW" && (
                <div className="field" style={{ marginTop: 16 }}>
                  <label htmlFor="review-note">Ghi chú rà soát</label>
                  <textarea id="review-note" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ví dụ: bệnh nhân bất tỉnh, cần biết thuốc chống đông" />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="btn primary" disabled={busy} onClick={() => review(selBg.id, "justified")}>Hợp lý</button>
                    <button className="btn danger" disabled={busy} onClick={() => review(selBg.id, "not_justified")}>Không hợp lý</button>
                  </div>
                  <span className="hint">Cần 2 người khác bác sĩ đó. Một ý kiến "không hợp lý" sẽ gắn cờ và đề xuất thu hồi quyền trực.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
