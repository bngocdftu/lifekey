"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/client/api";
import { PATIENT } from "@/lib/lifekey/catalogue";
import { Icon } from "./ui";

const NAV = [
  { href: "/", label: "Tổng quan", icon: "home" },
  { href: `/emergency/${PATIENT.publicId}`, label: "Bệnh nhân", icon: "patient", match: "/emergency" },
  { href: "/approve", label: "Duyệt yêu cầu", icon: "check", queue: true },
  { href: "/audit", label: "Nhật ký truy cập", icon: "list" },
] as const;
// A patient sees their own record, never the ward's screens.
const NAV_PATIENT = [
  { href: "/", label: "Tổng quan", icon: "home" },
  { href: "/me", label: "Hồ sơ của tôi", icon: "user" },
  { href: "/proof", label: "Kiểm chứng", icon: "shield" },
] as const;
const NAV_ADMIN = [
  { href: "/setup", label: "Đăng ký bệnh nhân", icon: "plus" },
  { href: "/proof", label: "Kiểm chứng", icon: "shield" },
] as const;

// Each person keeps one pale tint of their own hue, 60°+ apart.
const PEOPLE_HUE: Record<string, number> = { admin: 150, "doctor-a": 200, "doctor-b": 30, "doctor-c": 280, "patient-alice": 100 };
export function personTint(username: string) {
  const h = PEOPLE_HUE[username] ?? 100;
  return { background: `hsl(${h} 55% 92%)`, color: `hsl(${h} 45% 28%)` };
}
export function initials(username: string) {
  if (username === "admin") return "HS";
  if (username === "patient-alice") return "AN";
  const m = username.match(/^doctor-([a-z])$/);
  return m ? m[1].toUpperCase() : username.slice(0, 1).toUpperCase();
}
export function displayName(username: string) {
  if (username === "admin") return "Phòng hồ sơ";
  if (username === "patient-alice") return "Alice Nguyen";
  const m = username.match(/^doctor-([a-z])$/);
  return m ? `Bác sĩ ${m[1].toUpperCase()}` : username;
}

// The mark: a key bow and a cross, drawn for LifeKey.
function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 22 22" aria-hidden="true">
      <rect x="1" y="1" width="20" height="20" rx="7" fill="var(--accent)" />
      <path d="M11 5.5v6M8 8.5h6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M11 13v3.5M11 15h2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { authenticated, isInitializing, getValueFromIdToken, hasClientRole, hasRealmRole, login, logout } = useTideCloak();
  const api = useApi();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const username: string = authenticated ? getValueFromIdToken("preferred_username") ?? "" : "";
  const isApprover = authenticated && hasClientRole("tide-realm-admin", "realm-management");
  const isPatient = authenticated && hasRealmRole("lifekey-patient");

  // Record this user's Tide key server-side, so a later grant can name them.
  useEffect(() => {
    if (authenticated) api("/api/session", { method: "POST", body: {} }).catch(() => undefined);
  }, [authenticated, api]);

  useEffect(() => {
    if (!isApprover) return;
    api<{ items: unknown[] }>("/api/approvals").then((r) => setPending(r.items.length)).catch(() => setPending(null));
  }, [isApprover, api, pathname]);

  useEffect(() => setOpen(false), [pathname]);

  const main = isPatient ? NAV_PATIENT : NAV;
  const all = [...main, ...(isApprover ? NAV_ADMIN : [])];
  const current = all.find((n) => ("match" in n && n.match ? pathname.startsWith(n.match) : pathname === n.href));

  function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q) router.push(`/emergency/${encodeURIComponent(q)}`);
  }

  const item = (n: (typeof all)[number]) => {
    const active = current?.href === n.href;
    return (
      <a key={n.href} href={n.href} className="nav-item" aria-current={active ? "page" : undefined}>
        <Icon name={n.icon} />
        {n.label}
        {"queue" in n && n.queue && isApprover && pending ? <span className="count">{pending}</span> : null}
      </a>
    );
  };

  return (
    <div className="app">
      <aside className={`sidebar${open ? " open" : ""}`} aria-label="Điều hướng">
        <div className="row" style={{ padding: 0, minHeight: 0, alignItems: "center" }}>
          <a href="/" className="brand"><Mark /> LifeKey</a>
          <button className="btn ghost icon menu-toggle" style={{ marginLeft: "auto" }} onClick={() => setOpen(false)} aria-label="Đóng menu"><Icon name="close" /></button>
        </div>
        <div className="scope">
          <b>{isPatient ? "Hồ sơ cá nhân" : "Khoa cấp cứu"}</b>
          <span>Bệnh viện mô phỏng · dữ liệu giả lập</span>
        </div>
        {main.map(item)}
        {isApprover && (
          <>
            <div className="group-label">Quản trị</div>
            {NAV_ADMIN.map(item)}
          </>
        )}
        <div className="bottom">
          {process.env.NEXT_PUBLIC_LIFEKEY_PREVIEW === "1" && (
            <div className="notice small">
              Xem trước với dữ liệu mẫu, không có TideCloak. Đổi tài khoản:{" "}
              {["admin", "doctor-a", "doctor-b", "doctor-c", "patient-alice"].map((u, i) => (
                <span key={u}>{i ? ", " : ""}<a className="link" href={`?as=${u}`}>{displayName(u)}</a></span>
              ))}
            </div>
          )}
          {authenticated ? (
            <>
              <div className="user-row">
                <span className="avatar" style={personTint(username)}>{initials(username)}</span>
                <div>
                  <b>{displayName(username)}</b>
                  <span>{isPatient ? "Bệnh nhân" : isApprover ? "Người duyệt" : username === "admin" ? "Nhập hồ sơ" : "Bác sĩ"}</span>
                </div>
              </div>
              <button className="btn" onClick={logout}>Đăng xuất</button>
            </>
          ) : (
            !isInitializing && <button className="btn primary" onClick={login}>Đăng nhập bằng Tide</button>
          )}
        </div>
      </aside>

      <header className="topbar">
        <button className="btn ghost icon menu-toggle" onClick={() => setOpen(true)} aria-label="Mở menu"><Icon name="menu" /></button>
        <span className="page-name">{current?.label ?? "LifeKey"}</span>
        {isPatient ? <span style={{ marginRight: "auto" }} /> : (
          <form className="search" onSubmit={search} role="search">
            <label htmlFor="patient-search" className="sr-only">Mã trên QR của bệnh nhân</label>
            <input id="patient-search" placeholder="Tìm bệnh nhân theo mã QR, ví dụ p_8f29a1" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button className="search-go" type="submit" aria-label="Tìm"><Icon name="search" /></button>
          </form>
        )}
        <div className="right">
          {!authenticated && !isInitializing && <button className="btn primary" onClick={login}>Đăng nhập</button>}
        </div>
      </header>

      <main className="sheet">{children}</main>
    </div>
  );
}
