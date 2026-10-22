"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useEffect, useState } from "react";
import { short, useApi } from "@/lib/client/api";
import { PATIENT } from "@/lib/lifekey/catalogue";
import type { Caller } from "@/lib/auth/caller";
import { displayName, initials, personTint } from "./AppShell";
import { IconTile } from "./ui";

// What each demo account does next, in one line and one link.
const NEXT: Record<string, { text: string; href: string; cta: string }> = {
  admin: { text: "Đăng ký bệnh nhân mẫu và nhập hồ sơ. Bạn ghi được hồ sơ nhưng không đọc lại được.", href: "/setup", cta: "Mở trang đăng ký" },
  "doctor-a": { text: "Mở hồ sơ của Alice. Cảnh báo cấp cứu hiện ngay; hồ sơ chi tiết cần xin quyền.", href: `/emergency/${PATIENT.publicId}`, cta: "Mở hồ sơ bệnh nhân" },
  "doctor-b": { text: "Xem các yêu cầu đang chờ bạn ký và các lần mở khẩn cấp cần rà soát.", href: "/approve", cta: "Mở hàng chờ duyệt" },
  "doctor-c": { text: "Xem các yêu cầu đang chờ bạn ký và các lần mở khẩn cấp cần rà soát.", href: "/approve", cta: "Mở hàng chờ duyệt" },
  "doctor-d": { text: "Thử dùng quyền đọc của Bác sĩ A. Mạng Tide phải từ chối bạn.", href: "/proof", cta: "Mở trang kiểm chứng" },
};

const WAYS = [
  { name: "Cảnh báo cấp cứu", icon: "heart", tone: "pink" as const, who: "Mọi bác sĩ đã xác minh", wait: "Ngay khi đăng nhập", how: "Đã duyệt sẵn lúc bệnh nhân đăng ký." },
  { name: "Xin quyền đọc", icon: "key", tone: "teal" as const, who: "Một bác sĩ, một hồ sơ", wait: "Vài phút", how: "Cần 2 người duyệt. Tự hết hạn sau 2 giờ." },
  { name: "Mở khẩn cấp", icon: "bolt", tone: "orange" as const, who: "Bác sĩ trực cấp cứu", wait: "Vài giây", how: "Chỉ hồ sơ bệnh nhân cho phép. Ghi lý do, rà soát sau." },
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

  useEffect(() => {
    if (!authenticated) return;
    api<Caller>("/api/session", { method: "POST", body: {} }).then(setMe).catch((e) => setError(e.message));
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
