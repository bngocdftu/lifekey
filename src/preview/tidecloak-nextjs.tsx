"use client";

// PREVIEW ONLY. Stands in for @tidecloak/nextjs when LIFEKEY_PREVIEW=1 (npm run preview), so the
// screens can be looked at without TideCloak. Pick the account with ?as=doctor-a (remembered).
// Nothing here talks to Tide or enforces anything.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { previewFetch } from "./fixtures";

const USERS: Record<string, { roles: string[]; approver: boolean }> = {
  admin: { roles: ["lifekey-recorder", "_tide_encryptor"], approver: true },
  "doctor-a": { roles: ["lifekey-clinician", "er-attending", "_tide_decryptor"], approver: false },
  "doctor-b": { roles: [], approver: true },
  "doctor-c": { roles: [], approver: true },
  "patient-alice": { roles: ["lifekey-patient", "_tide_decryptor"], approver: false },
};

function currentUser(): string {
  if (typeof window === "undefined") return "doctor-a";
  const q = new URLSearchParams(window.location.search).get("as");
  try {
    if (q && USERS[q]) localStorage.setItem("lk-preview-as", q);
    return (q && USERS[q] ? q : localStorage.getItem("lk-preview-as")) || "doctor-a";
  } catch {
    return q && USERS[q] ? q : "doctor-a";
  }
}

const Ctx = createContext<ReturnType<typeof build> | null>(null);

function build(user: string | null) {
  const u = user ? USERS[user] : undefined;
  return {
    authenticated: !!user,
    isInitializing: user === null,
    token: "preview",
    login: async () => undefined,
    logout: async () => undefined,
    getValueFromIdToken: (k: string) => (k === "preferred_username" ? user : undefined),
    getValueFromToken: (k: string) => (k === "preferred_username" ? user : undefined),
    hasRealmRole: (r: string) => !!u?.roles.includes(r),
    hasClientRole: (r: string) => r === "tide-realm-admin" && !!u?.approver,
    secureFetch: (url: string, init?: RequestInit) => previewFetch(user ?? "doctor-a", USERS[user ?? "doctor-a"], url, init),
    doEncrypt: async () => [],
    doDecrypt: async () => [],
  };
}

export function TideCloakProvider({ children }: { children: React.ReactNode; config?: unknown }) {
  const [user, setUser] = useState<string | null>(null);
  useEffect(() => setUser(currentUser()), []);
  const value = useMemo(() => build(user), [user]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTideCloak() {
  const v = useContext(Ctx);
  if (!v) throw new Error("preview TideCloakProvider missing");
  return v;
}

export function useAuthCallback() {
  return { isProcessing: false, isSuccess: true, error: null };
}
