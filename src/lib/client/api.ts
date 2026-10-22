"use client";

import { useTideCloak } from "@tidecloak/nextjs";
import { useCallback } from "react";
import { decryptForRecord, encryptForRecord, readSession } from "@/lib/tide/relationship";

// Every call to our API goes through secureFetch: the server verifies the token AND the DPoP proof.
export function useApi() {
  const { secureFetch } = useTideCloak();
  return useCallback(
    async <T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
      const res = await secureFetch(path, {
        method: init.method ?? "GET",
        headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = body.errors ? body.errors.join("; ") : body.error ?? `HTTP ${res.status}`;
        throw Object.assign(new Error(msg), { status: res.status, body });
      }
      return body as T;
    },
    [secureFetch],
  );
}

/**
 * The network's refusal arrives as "Could not reach enough VVK ORKs"; the contract's own reason is
 * in `cause`. Show that, not the wrapper.
 */
export function networkReason(e: unknown): string {
  const parts: string[] = [];
  let cur: any = e;
  for (let i = 0; cur && i < 5; i++) {
    if (cur.message) parts.push(String(cur.message));
    cur = cur.cause;
  }
  const text = parts.join(" ← ");
  return text || String(e);
}

export async function decryptRecord(ciphertext: string, recordId: string, policyB64: string): Promise<string> {
  return decryptForRecord(ciphertext, recordId, policyB64);
}

export async function encryptRecord(plaintext: string, recordId: string, policyB64: string): Promise<string> {
  return encryptForRecord(plaintext, recordId, policyB64);
}

export { readSession };

export function short(key: string, n = 10): string {
  return key.length > n * 2 ? `${key.slice(0, n)}…${key.slice(-4)}` : key;
}

export function fmtTime(epochSeconds?: number): string {
  if (!epochSeconds) return "—";
  return new Date(epochSeconds * 1000).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}
