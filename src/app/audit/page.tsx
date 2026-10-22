"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useCallback, useEffect, useState } from "react";
import { fmtTime, useApi } from "@/lib/client/api";
import type { AuditEntry } from "@/lib/lifekey/audit";
import { displayName } from "../AppShell";
import { BarList, Columns, Donut, HashChain, type Bucket } from "../charts";

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
// Kinds of work, for the donut: grouped the way a ward would count them.
const GROUPS: { key: string; label: string; color: string; match: (a: string) => boolean }[] = [
  { key: "read", label: "Đọc, ghi hồ sơ", color: "var(--teal)", match: (a) => a.startsWith("record.") || a === "patient.lookup" },
  { key: "grant", label: "Quyền", color: "var(--green)", match: (a) => a.startsWith("grant.") || a.startsWith("policy.") },
  { key: "request", label: "Xin quyền đọc", color: "var(--orange)", match: (a) => a.startsWith("request.") },
  { key: "bg", label: "Mở khẩn cấp", color: "var(--pink)", match: (a) => a.startsWith("break-glass.") },
  { key: "other", label: "Khác", color: "var(--grey)", match: () => true },
];

/** Hourly buckets (wider when the log spans more than a day) from oldest to newest. */
function bucketize(entries: AuditEntry[]): Bucket[] {
  if (!entries.length) return [];
  const ats = entries.map((e) => e.at);
  const size = Math.max(3600, Math.ceil((Math.max(...ats) - Math.min(...ats) + 1) / 24 / 3600) * 3600);
  const first = Math.floor(Math.min(...ats) / size) * size;
  const n = Math.floor((Math.max(...ats) - first) / size) + 1;
  return Array.from({ length: n }, (_, i) => {
    const from = first + i * size;
    const inside = entries.filter((e) => e.at >= from && e.at < from + size);
    const ok = inside.filter((e) => e.outcome !== "denied" && e.outcome !== "error").length;
    const bad = inside.length - ok;
    const hour = new Date(from * 1000).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
    return {
      label: hour,
      tip: `${fmtTime(from)}: ${ok} thành công, ${bad} bị từ chối`,
      values: [{ key: "ok", value: ok, color: "var(--positive)" }, { key: "bad", value: bad, color: "var(--negative)" }],
    };
  });
}

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

  const all = data?.entries ?? [];
  const buckets = bucketize(all);
  const byActor = Object.entries(all.reduce<Record<string, number>>((m, e) => ({ ...m, [e.actor]: (m[e.actor] ?? 0) + 1 }), {}))
    .sort((a, b) => b[1] - a[1]);
  const groupCounts = GROUPS.map((g) => ({ key: g.key, label: g.label, color: g.color, value: all.filter((e) => GROUPS.find((x) => x.match(e.action))?.key === g.key).length }));
  const chain = [...all].reverse().slice(-14);

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

      {all.length > 0 && (
        <div className="chart-grid">
          <section className="panel span-8" aria-labelledby="act-h">
            <header>
              <h2 id="act-h">Hoạt động theo giờ</h2>
              <span className="legend-inline"><span><i style={{ background: "var(--positive)" }} />Thành công</span><span><i style={{ background: "var(--negative)" }} />Bị từ chối</span></span>
            </header>
            <Columns buckets={buckets} label="Số việc theo giờ, chia thành công và bị từ chối" every={Math.max(1, Math.ceil(buckets.length / 8))} />
          </section>
          <section className="panel span-4" aria-labelledby="kind-h">
            <header><h2 id="kind-h">Theo loại việc</h2></header>
            <Donut label="Việc theo loại" parts={groupCounts} center={all.length} sub="mục" />
          </section>
          <section className="panel span-6" aria-labelledby="who-h">
            <header><h2 id="who-h">Ai làm nhiều nhất</h2><span className="meta">Số mục trong nhật ký</span></header>
            <BarList rows={byActor.map(([a, n]) => ({ key: a, label: a === "lifekey-server" ? "Máy chủ" : displayName(a), value: n, note: a }))} />
          </section>
          <section className="panel span-6" aria-labelledby="chain-h">
            <header>
              <h2 id="chain-h">Chuỗi kiểm tra</h2>
              <span className={`pill ${data?.brokenAt === null ? "pos" : "neg"}`}>{data?.brokenAt === null ? "Nguyên vẹn" : `Gãy từ mục ${data?.brokenAt}`}</span>
            </header>
            <HashChain brokenAt={data?.brokenAt ?? null} items={chain.map((e) => ({
              seq: e.seq, hash: e.hash, ok: e.outcome !== "denied" && e.outcome !== "error",
              tip: `#${e.seq} ${ACTION_TEXT[e.action] ?? e.action} · ${OUTCOME[e.outcome]?.text ?? e.outcome}`,
            }))} />
            <p className="small faint" style={{ marginTop: 12 }}>{chain.length} mục gần nhất. Mỗi mục mang mã băm của mục trước, nên sửa hay xoá một mục sẽ làm gãy chuỗi từ đó.</p>
          </section>
        </div>
      )}

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
