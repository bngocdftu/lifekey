"use client";

import { IAMService } from "@tidecloak/js";

// Approve change requests the way the TideCloak admin console does: from the APPROVER'S browser,
// with the approver's own token, signed in their own Tide enclave. Never through our server:
// TideCloak credits an approval to whoever made the HTTP call.

type SecureFetch = (url: string, init?: RequestInit) => Promise<Response>;

interface TideClient {
  requestTideOperatorApproval(
    requests: { id: string; request: Uint8Array }[],
  ): Promise<{ id: string; request: Uint8Array; status: "approved" | "denied" | "pending" }[]>;
}

const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface ApproveResult {
  id: string;
  outcome: "recorded" | "denied" | "error";
  committed?: boolean;
  authCount?: number;
  threshold?: number;
  message?: string;
}

export async function approveChangeRequests(
  secureFetch: SecureFetch,
  tidecloak: { url: string; realm: string },
  ids: string[],
): Promise<ApproveResult[]> {
  const endpoint = (id: string) => `${tidecloak.url}/admin/realms/${tidecloak.realm}/iga/change-requests/${encodeURIComponent(id)}/approve`;
  const post = async (id: string, body: unknown) => {
    const res = await secureFetch(endpoint(id), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${json.error ?? json.errorMessage ?? JSON.stringify(json)}`);
    return json;
  };

  const results: ApproveResult[] = [];
  const toSign: { id: string; request: Uint8Array }[] = [];

  // Phase 1: ask TideCloak what to sign.
  for (const id of ids) {
    try {
      const r = await post(id, {});
      if (r.mode === "needs-approval") toSign.push({ id, request: fromBase64(r.requestModel) });
      else results.push({ id, outcome: "recorded", committed: r.committed, authCount: r.authCount, threshold: r.threshold, message: "already recorded for you" });
    } catch (e) {
      results.push({ id, outcome: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
  if (!toSign.length) return results;

  // One enclave pop-up for the whole batch. Must run from a click, or the pop-up is blocked.
  const tc = (IAMService as unknown as { _tc: TideClient | null })._tc;
  if (!tc) throw new Error("TideCloak is not initialised");
  const signed = await tc.requestTideOperatorApproval(toSign);

  // Phase 2: hand back each signed request. TideCloak commits by itself at quorum.
  for (const s of signed) {
    if (s.status !== "approved") {
      results.push({ id: s.id, outcome: "denied", message: `enclave: ${s.status}` });
      continue;
    }
    try {
      const r = await post(s.id, { requestModel: toBase64(s.request) });
      results.push({ id: s.id, outcome: "recorded", committed: r.committed, authCount: r.authCount, threshold: r.threshold });
    } catch (e) {
      results.push({ id: s.id, outcome: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

// The deny endpoint takes no body; LifeKey's audit log carries the reason.
export async function denyChangeRequest(secureFetch: SecureFetch, tidecloak: { url: string; realm: string }, id: string) {
  const res = await secureFetch(`${tidecloak.url}/admin/realms/${tidecloak.realm}/iga/change-requests/${encodeURIComponent(id)}/deny`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`deny: HTTP ${res.status}`);
}
