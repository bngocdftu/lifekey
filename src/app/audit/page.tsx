"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useCallback, useEffect, useState } from "react";
import { fmtTime, useApi } from "@/lib/client/api";
import type { AuditEntry } from "@/lib/lifekey/audit";
import { displayName } from "../AppShell";

// Actions as a clerk would write them in the ward book.
const ACTION_TEXT: Record<string, string> = {
  "session.first-sign-in": "Đăng nhập lần đầu",
  "patient.lookup": "Mở hồ sơ bệnh nhân",
  "record.write": "Nhập hồ sơ",
  "record.decrypt": "Đọc hồ sơ",
  "grant.file": "Gửi quyền cho người duyệt",
  "grant.signed": "Quyền được ký",
  "grant.denied": "Quyền bị từ chối",
  "grant.verify": "Quyền không khớp",
  "request.create": "Xin quyền đọc",
  "request.status": "Yêu cầu đổi trạng thái",
  "break-glass.declare": "Mở khẩn cấp",
  "break-glass.review": "Rà soát mở khẩn cấp",
  "policy.release.tier1": "Lấy quyền xem cảnh báo",
  "policy.release.write": "Lấy quyền ghi",
  "policy.release.break-glass": "Lấy quyền mở khẩn cấp",
  "policy.release.request": "Lấy quyền đọc đã duyệt",
  "proof.server-approve": "Máy chủ thử tự duyệt",
};
const OUTCOME: Record<string, { text: string; cls: string }> = {
  ok: { text: "Thành công", cls: "pos" },
  denied: { text: "Bị từ chối", cls: "neg" },
  error: { text: "Lỗi", cls: "neg" },
  info: { text: "Ghi nhận", cls: "" },
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
        <div className="title-row"><div><h1>Nhật ký truy cập</h1><p className="sub">Đăng nhập để xem.</p></div></div>
        <button className="btn primary" onClick={login}>Đăng nhập bằng Tide</button>
      </>
    );
  }

  const entries = (data?.entries ?? []).filter((e) => filter === "all" || e.outcome === "denied" || e.outcome === "error");
  const deniedCount = (data?.entries ?? []).filter((e) => e.outcome === "denied" || e.outcome === "error").length;

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Nhật ký truy cập</h1>
          <p className="sub">
            {data ? (
              data.brokenAt === null
                ? <>{data.entries.length.toLocaleString("vi-VN")} mục, chuỗi kiểm tra <b>nguyên vẹn</b>.</>
                : <>Chuỗi kiểm tra <b style={{ color: "var(--negative)" }}>bị sửa từ mục {data.brokenAt}</b>.</>
            ) : "Đang tải…"}
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={load}>Tải lại</button>
        </div>
      </div>
      {err && <p className="notice neg" style={{ marginBottom: 24 }}>{err}</p>}

      <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
        <button role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>Tất cả<span className="count">{data?.entries.length ?? 0}</span></button>
        <button role="tab" aria-selected={filter === "denied"} onClick={() => setFilter("denied")}>Bị từ chối<span className="count">{deniedCount}</span></button>
      </div>

      <div className="as-list audit-table">
        <div className="table-wrap">
          <table>
            <thead><tr><th className="n">#</th><th>Lúc</th><th>Ai</th><th>Việc</th><th>Hồ sơ</th><th className="n">Kết quả</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.seq}>
                  <td className="n faint seq">{e.seq}</td>
                  <td className="num meta-cell">{fmtTime(e.at)}</td>
                  <td className="meta-cell">{e.actor === "lifekey-server" ? "Máy chủ" : displayName(e.actor)}</td>
                  <td className="act">{ACTION_TEXT[e.action] ?? e.action}{e.detail && <span className="sub">{e.detail.replace(/^client-reported: /, "Trình duyệt báo: ")}</span>}</td>
                  <td className="mono meta-cell">{e.resource}</td>
                  <td className="n res"><span className={`pill ${OUTCOME[e.outcome]?.cls ?? ""}`}>{OUTCOME[e.outcome]?.text ?? e.outcome}</span></td>
                </tr>
              ))}
              {!entries.length && <tr><td colSpan={6} className="muted">{filter === "denied" ? "Chưa có lần nào bị từ chối." : "Chưa có mục nào."}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="small faint" style={{ marginTop: 16 }}>Nhật ký không bao giờ chứa nội dung hồ sơ. Mục "Trình duyệt báo" do máy của bác sĩ gửi về, vì máy chủ không nhìn thấy lúc giải mã.</p>
    </>
  );
}
