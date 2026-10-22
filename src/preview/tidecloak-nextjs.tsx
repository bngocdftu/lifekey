"use client";

// PREVIEW ONLY. Stands in for @tidecloak/nextjs when LIFEKEY_PREVIEW=1 (npm run preview). TideCloak
// is simulated (sim-tide.ts): "Sign in with Tide" opens a Tide-style sign-in, the session carries
// TideCloak-shaped claims and expires, and every API call is refused once it has. ?as=doctor-a
// signs that account in straight away, for demo links. Nothing here is secure.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { previewFetch } from "./fixtures";
import {
  ROLE_REALM_ADMIN, SIM_ACCOUNTS, SIM_REALM_URL, simAccount, simClaims, simReadSession, simRefresh,
  simSessionValid, simSignIn, simSignOut, type SimSession,
} from "./sim-tide";

const Ctx = createContext<ReturnType<typeof build> | null>(null);

function sessionFromUrl(): SimSession | null {
  const q = new URLSearchParams(window.location.search).get("as");
  if (q && simAccount(q)) return simSignIn(q, "preview");
  const s = simReadSession();
  return simSessionValid(s) ? s : null;
}

function build(session: SimSession | null | undefined, login: () => void, logout: () => void) {
  const claims = session ? simClaims(session) : null;
  const claim = (k: string) => (claims ? (claims as Record<string, unknown>)[k] : undefined) as never;
  const user = session?.username;
  const account = simAccount(user);
  return {
    authenticated: !!session,
    isInitializing: session === undefined,
    token: claims ? `sim.${btoa(JSON.stringify(claims))}.unsigned` : "",
    login: async () => login(),
    logout: async () => logout(),
    getValueFromIdToken: claim,
    getValueFromToken: claim,
    hasRealmRole: (r: string) => !!claims?.realm_access.roles.includes(r),
    hasClientRole: (r: string, client = "realm-management") =>
      !!(claims?.resource_access as Record<string, { roles: string[] }> | undefined)?.[client]?.roles.includes(r),
    // Like the real SDK: refresh the token before each call, and fail with 401 once the session is gone.
    secureFetch: async (url: string, init?: RequestInit) => {
      const current = simReadSession();
      if (!account || !simSessionValid(current) || current.username !== user) {
        return new Response(JSON.stringify({ error: "token expired or missing: sign in with Tide again" }), { status: 401 });
      }
      simRefresh(current);
      return previewFetch(user!, { roles: account.realmRoles, approver: account.approver }, url, init);
    },
    doEncrypt: async () => [],
    doDecrypt: async () => [],
  };
}

export function TideCloakProvider({ children }: { children: React.ReactNode; config?: unknown }) {
  // undefined: still reading the session; null: signed out.
  const [session, setSession] = useState<SimSession | null | undefined>(undefined);
  const [signingIn, setSigningIn] = useState(false);
  useEffect(() => setSession(sessionFromUrl()), []);
  const login = useCallback(() => setSigningIn(true), []);
  const logout = useCallback(() => {
    simSignOut();
    setSession(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has("as")) {
      url.searchParams.delete("as");
      history.replaceState(null, "", url);
    }
  }, []);
  const value = useMemo(() => build(session, login, logout), [session, login, logout]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {signingIn && <SimSignIn onDone={(s) => { setSigningIn(false); if (s) setSession(s); }} />}
    </Ctx.Provider>
  );
}

/** The Tide sign-in page, simulated. On the real system this is TideCloak's page, not LifeKey's. */
function SimSignIn({ onDone }: { onDone: (s: SimSession | null) => void }) {
  const [username, setUsername] = useState("doctor-a");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      onDone(simSignIn(username, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="sim-signin-title" style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", padding: 16, background: "rgba(18,33,42,.45)" }}>
      <form onSubmit={submit} style={{ width: "min(400px, 100%)", background: "var(--surface)", color: "var(--text)", borderRadius: "var(--radius)", padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,.25)", display: "grid", gap: 12 }}>
        <div style={{ fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>TideCloak · simulated</div>
        <h2 id="sim-signin-title" style={{ margin: 0, fontSize: 20 }}>Sign in with Tide</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>Realm <code>{SIM_REALM_URL.split("/").pop()}</code>. Any password works in the simulation; on the real network your key never leaves the Tide enclave.</p>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          Account
          <select value={username} onChange={(e) => setUsername(e.target.value)} style={{ padding: 10, borderRadius: 12, border: "1px solid var(--control)", font: "inherit", width: "100%", minWidth: 0, boxSizing: "border-box" }}>
            {SIM_ACCOUNTS.map((a) => (
              <option key={a.username} value={a.username}>{a.username} — {a.about}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
          Password
          <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} style={{ padding: 10, borderRadius: 12, border: "1px solid var(--control)", font: "inherit", width: "100%", minWidth: 0, boxSizing: "border-box" }} />
        </label>
        <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
          Roles: {simAccount(username)?.realmRoles.join(", ")}
          {simAccount(username)?.approver ? `, ${ROLE_REALM_ADMIN} (approver)` : ""}
        </p>
        {error && <p role="alert" style={{ margin: 0, color: "var(--negative)", fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={() => onDone(null)}>Cancel</button>
          <button type="submit" className="btn primary">Sign in</button>
        </div>
      </form>
    </div>
  );
}

export function useTideCloak() {
  const v = useContext(Ctx);
  if (!v) throw new Error("preview TideCloakProvider missing");
  return v;
}

export function useAuthCallback() {
  return { isProcessing: false, isSuccess: true, error: null };
}
