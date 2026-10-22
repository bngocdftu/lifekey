"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useEffect, useState } from "react";
import { short, useApi } from "@/lib/client/api";
import { PATIENT } from "@/lib/lifekey/catalogue";
import type { Caller } from "@/lib/auth/caller";
import { displayName, initials, personTint } from "./AppShell";
import type { AuditEntry } from "@/lib/lifekey/audit";
import { AreaChart, Donut, StepTrack } from "./charts";
import { Icon, IconTile } from "./ui";

// What each demo account does next, in one line and one link.
const NEXT: Record<string, { text: string; href: string; cta: string }> = {
  admin: { text: "Đăng ký bệnh nhân mẫu và nhập hồ sơ. Bạn ghi được hồ sơ nhưng không đọc lại được.", href: "/setup", cta: "Mở trang đăng ký" },
  "doctor-a": { text: "Mở hồ sơ của Alice. Cảnh báo cấp cứu hiện ngay; hồ sơ chi tiết cần xin quyền.", href: `/emergency/${PATIENT.publicId}`, cta: "Mở hồ sơ bệnh nhân" },
  "doctor-b": { text: "Xem các yêu cầu đang chờ bạn ký và các lần mở khẩn cấp cần rà soát.", href: "/approve", cta: "Mở hàng chờ duyệt" },
  "doctor-c": { text: "Xem các yêu cầu đang chờ bạn ký và các lần mở khẩn cấp cần rà soát.", href: "/approve", cta: "Mở hàng chờ duyệt" },
  "doctor-d": { text: "Thử dùng quyền đọc của Bác sĩ A. Mạng Tide phải từ chối bạn.", href: "/proof", cta: "Mở trang kiểm chứng" },
};

const WAYS = [
  { name: "Cảnh báo cấp cứu", icon: "heart", tone: "pink" as const, who: "Mọi bác sĩ đã xác minh", wait: "Ngay khi đăng nhập", speed: 0, how: "Đã duyệt sẵn lúc bệnh nhân đăng ký." },
  { name: "Xin quyền đọc", icon: "key", tone: "teal" as const, who: "Một bác sĩ, một hồ sơ", wait: "Vài phút", speed: 2, how: "Cần 2 người duyệt. Tự hết hạn sau 2 giờ." },
  { name: "Mở khẩn cấp", icon: "bolt", tone: "orange" as const, who: "Bác sĩ trực cấp cứu", wait: "Vài giây", speed: 1, how: "Chỉ hồ sơ bệnh nhân cho phép. Ghi lý do, rà soát sau." },
];
const SPEED = ["Ngay", "Vài giây", "Vài phút"];

// What an account can do, checked against its roles.
const CAPS: { label: string; has: (me: Caller) => boolean }[] = [
  { label: "Xem cảnh báo", has: (m) => m.realmRoles.includes("lifekey-clinician") },
  { label: "Mở khẩn cấp", has: (m) => m.realmRoles.includes("er-attending") },
  { label: "Đọc khi có quyền", has: (m) => m.realmRoles.includes("_tide_decryptor") },
  { label: "Ghi hồ sơ", has: (m) => m.realmRoles.includes("lifekey-recorder") },
  { label: "Duyệt yêu cầu", has: (m) => m.isApprover },
];

// A short to-do per demo account; "done" marks what the sample data already covers.
const STEPS: Record<string, { title: string; note: string; done?: boolean }[]> = {
  admin: [
    { title: "Gửi các quyền bệnh nhân đồng ý", note: "Bác sĩ B và C ký ở trang Duyệt yêu cầu" },
    { title: "Nhập 4 hồ sơ mẫu", note: "Mã hoá trên máy này, máy chủ chỉ giữ bản mã" },
    { title: "Kiểm tra bạn không đọc lại được", note: "Trang Kiểm chứng, phép thử R1" },
  ],
  "doctor-a": [
    { title: "Xem cảnh báo cấp cứu của Alice", note: "Warfarin, dị ứng penicillin, van tim" },
    { title: "Xin quyền đọc danh sách thuốc", note: "Chờ Bác sĩ B và C ký" },
    { title: "Thử mở khẩn cấp", note: "Ghi lý do, người duyệt sẽ rà soát sau" },
  ],
  "doctor-b": [
    { title: "Ký các yêu cầu đang chờ", note: "Kiểm tra lý do và hạn dùng trước khi ký" },
    { title: "Rà soát lần mở khẩn cấp", note: "Hạn 72 giờ sau khi mở" },
  ],
  "doctor-c": [
    { title: "Ký các yêu cầu đang chờ", note: "Một yêu cầu cần 2 trong 3 người duyệt" },
    { title: "Rà soát lần mở khẩn cấp", note: "Hạn 72 giờ sau khi mở" },
  ],
  "doctor-d": [
    { title: "Thử dùng quyền đọc của Bác sĩ A", note: "Mạng Tide phải từ chối bạn" },
    { title: "Xem cảnh báo cấp cứu", note: "Bạn là bác sĩ đã xác minh nên xem được" },
  ],
};

const ROLE_TEXT: Record<string, string> = {
  "lifekey-clinician": "Bác sĩ đã xác minh",
  "er-attending": "Trực cấp cứu",
  "lifekey-recorder": "Nhập hồ sơ",
  _tide_decryptor: "Được đọc khi có quyền",
  _tide_encryptor: "Được ghi khi có quyền",
};

export default function HomePage() {
  const { authenticated, isInitializing, login } = useTideCloak();
  const api = useApi();
  const [me, setMe] = useState<Caller | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<AuditEntry[]>([]);

  useEffect(() => {
    if (!authenticated) return;
    api<Caller>("/api/session", { method: "POST", body: {} }).then(setMe).catch((e) => setError(e.message));
    api<{ entries: AuditEntry[] }>("/api/audit").then((d) => setLog(d.entries)).catch(() => undefined);
  }, [authenticated, api]);

  if (isInitializing) return <p className="muted">Đang tải…</p>;

  if (!authenticated) {
    return (
      <>
        <div className="title-row">
          <div>
            <h1>LifeKey</h1>
            <p className="sub">Bác sĩ cấp cứu thấy ngay dị ứng, thuốc đang dùng và thiết bị cấy ghép. Hồ sơ chi tiết chỉ mở cho đúng người, đúng hồ sơ, trong thời gian ngắn.</p>
          </div>
        </div>
        <div className="grid">
          <div className="panel span-7">
            <header><h2>Đăng nhập</h2></header>
            <p className="muted">Có 5 tài khoản thử: Phòng hồ sơ, Bác sĩ A, B, C, D. Mỗi tài khoản nên dùng một hồ sơ trình duyệt riêng.</p>
            <p style={{ marginTop: 16 }}><button className="btn primary" onClick={login}>Đăng nhập bằng Tide</button></p>
          </div>
          <div className="panel well span-5">
            <header><h2>Bản thử nghiệm</h2></header>
            <p className="muted">Toàn bộ bệnh nhân và hồ sơ là giả lập. Không dùng cho người bệnh thật.</p>
          </div>
        </div>
      </>
    );
  }

  // The last 24 hours of the log, one point per hour.
  const hourNow = Math.floor(Date.now() / 3600_000) * 3600;
  const hours = Array.from({ length: 24 }, (_, i) => hourNow - (23 - i) * 3600);
  const perHour = hours.map((h) => log.filter((e) => e.at >= h && e.at < h + 3600).length);
  const hourLabels = hours.map((h) => new Date(h * 1000).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }));
  const denied = log.filter((e) => e.outcome === "denied" || e.outcome === "error").length;

  const next = me ? NEXT[me.username] : undefined;
  const steps = me ? STEPS[me.username] ?? [] : [];

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{me ? `Chào ${displayName(me.username)}` : "Tổng quan"}</h1>
          <p className="sub">Khoa cấp cứu · bệnh viện mô phỏng</p>
        </div>
      </div>
      {error && <p className="notice neg" style={{ marginBottom: 20 }}>Không tải được tài khoản: {error}</p>}

      {log.length > 0 && (
        <div className="chart-grid">
          <section className="panel span-8" aria-labelledby="act-h">
            <header>
              <h2 id="act-h">Hoạt động 24 giờ qua</h2>
              <span className="meta num">{perHour.reduce((a, b) => a + b, 0)} việc · <a className="link" href="/audit">Xem nhật ký</a></span>
            </header>
            <AreaChart points={perHour} labels={hourLabels} label="Số việc trong nhật ký mỗi giờ, 24 giờ qua" />
          </section>
          <section className="panel span-4" aria-labelledby="out-h">
            <header><h2 id="out-h">Kết quả truy cập</h2></header>
            <Donut label="Kết quả truy cập" size={116} center={`${Math.round(((log.length - denied) / log.length) * 100)}%`} sub="thành công"
              parts={[
                { key: "ok", label: "Thành công", value: log.length - denied, color: "var(--positive)" },
                { key: "bad", label: "Bị từ chối", value: denied, color: "var(--negative)" },
              ]} />
          </section>
        </div>
      )}

      <div className="grid">
        <div className="stack span-8">
          {next && (
            <section className="panel">
              <header>
                <h2>Việc của bạn hôm nay</h2>
                <span className="pill acc">{steps.filter((x) => x.done).length}/{steps.length}</span>
              </header>
              <ol className="todo">
                {steps.map((st) => (
                  <li key={st.title} className={st.done ? "done" : ""}>
                    <i className="dot" aria-hidden="true" />
                    <div><b>{st.title}</b><span>{st.note}</span></div>
                  </li>
                ))}
              </ol>
              <a className="btn primary" style={{ marginTop: 20 }} href={next.href}>{next.cta}</a>
            </section>
          )}

          <section>
            <div className="title-row" style={{ marginBottom: 12, alignItems: "baseline" }}>
              <h2 style={{ fontSize: 17, fontWeight: 600 }}>Ba cách xem hồ sơ</h2>
            </div>
            <div className="tiles">
              {WAYS.map((w) => (
                <div key={w.name} className="tile">
                  <IconTile name={w.icon} tone={w.tone} />
                  <b>{w.name}</b>
                  <span>{w.who}</span>
                  <span className="pill" style={{ marginTop: 2 }}>{w.wait}</span>
                  <StepTrack steps={SPEED} at={w.speed} />
                  <span>{w.how}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="panel span-4">
          <div className="head" style={{ marginBottom: 14 }}>
            {me && <span className="avatar" style={{ ...personTint(me.username), width: 44, height: 44, fontSize: 15 }}>{initials(me.username)}</span>}
            <div><span className="label">Tài khoản:</span><span className="value">{me ? displayName(me.username) : "…"}</span></div>
          </div>
          {me ? (
            <>
              <dl className="kv">
                <div><dt>Tên đăng nhập:</dt><dd>{me.username}</dd></div>
                <div><dt>Khoá Tide:</dt><dd className="mono">{short(me.tideUserKey || "—", 6)}</dd></div>
                <div><dt>Người duyệt:</dt><dd>{me.isApprover ? "Có" : "Không"}</dd></div>
              </dl>
              <div style={{ marginTop: 14 }}>
                <span className="small faint" style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span>Việc tài khoản này làm được</span><b className="num" style={{ color: "var(--text)" }}>{CAPS.filter((c) => c.has(me)).length}/{CAPS.length}</b>
                </span>
                <ul className="caps">
                  {CAPS.map((c) => (
                    <li key={c.label} className={c.has(me) ? "on" : "off"}><Icon name={c.has(me) ? "tick" : "x"} />{c.label}</li>
                  ))}
                </ul>
              </div>
              <div className="inset" style={{ marginTop: 14 }}>
                <span className="small faint" style={{ display: "block", marginBottom: 8 }}>Vai trò</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {me.realmRoles.filter((r) => ROLE_TEXT[r]).map((r) => <span key={r} className="pill acc">{ROLE_TEXT[r]}</span>)}
                  {!me.realmRoles.some((r) => ROLE_TEXT[r]) && <span className="small muted">Không có quyền đọc hồ sơ</span>}
                </div>
              </div>
            </>
          ) : <p className="muted">Đang tải…</p>}
        </section>
      </div>
    </>
  );
}
