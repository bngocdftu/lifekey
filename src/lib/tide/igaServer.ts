// Server-side calls to TideCloak's IGA API. Local development only.
//
// The server authenticates as the TideCloak MASTER admin. That is enough to FILE a change request
// and to READ a signed policy, and nothing more: in multiAdmin mode an approval needs a
// tide-realm-admin's enclave signature, which only that person's browser can produce. Approvals are
// therefore never proxied through here (approvals are credited to the HTTP caller, so a proxy
// would collapse every approver into one vote).

import { loadTideConfig } from "@/lib/auth/tidecloakConfig";

function baseUrl(): string {
  return (process.env.TIDECLOAK_URL || loadTideConfig()["auth-server-url"]).replace(/\/+$/, "");
}

function realm(): string {
  return loadTideConfig().realm;
}

export function vendorId(): string {
  const id = loadTideConfig().vendorId;
  if (!id) throw new Error("data/tidecloak.json has no vendorId: run npm run init");
  return id;
}

// Master-admin tokens live about a minute, so fetch one per operation.
async function masterToken(): Promise<string> {
  const user = process.env.KC_BOOTSTRAP_ADMIN_USERNAME || "admin";
  const pass = process.env.KC_BOOTSTRAP_ADMIN_PASSWORD;
  if (!pass) throw new Error("KC_BOOTSTRAP_ADMIN_PASSWORD is not set (see .env.example)");
  const res = await fetch(`${baseUrl()}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: "admin-cli", grant_type: "password", username: user, password: pass }),
  });
  if (!res.ok) throw new Error(`master token: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

async function admin(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await masterToken();
  return fetch(`${baseUrl()}/admin/realms/${realm()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
  });
}

/**
 * Raise the governed request that gets a policy signed. 202 means captured, NOT signed: the policy
 * exists only once the admin quorum approves the change request.
 */
export async function fileJitPolicy(name: string, unsignedPolicyB64: string): Promise<{ changeRequestId: string }> {
  const res = await admin("/iga/jit-policies", { method: "POST", body: JSON.stringify({ name, policy: unsignedPolicyB64 }) });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 202) throw new Error(`jit-policies: HTTP ${res.status} ${JSON.stringify(body)}`);
  return { changeRequestId: body.changeRequestId };
}

/** The signed policy, or null while the quorum has not approved it yet. */
export async function getSignedPolicy(name: string): Promise<{ policyB64: string } | null> {
  const res = await admin(`/iga/role-policies/name/${encodeURIComponent(name)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`role-policies: HTTP ${res.status}`);
  const body = await res.json();
  if (!body.policy || !body.policySig) return null;
  return { policyB64: body.policy };
}

export interface ChangeRequestSummary {
  id: string;
  actionType: string;
  entityType: string;
  status: string;
  requestedBy?: string;
  authorizationCount?: number;
  threshold?: number;
  readyToCommit?: boolean;
  authorizers?: { username: string; timestamp?: number }[];
}

export async function getChangeRequest(id: string): Promise<ChangeRequestSummary | null> {
  const res = await admin(`/iga/change-requests/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`change-requests/${id}: HTTP ${res.status}`);
  return res.json();
}

/**
 * For the proof page: what happens when a server holding admin credentials tries to approve on
 * its own. In multiAdmin mode the expected answer is a refusal or a "needs-approval" challenge it
 * cannot sign.
 */
export async function tryServerSideApprove(id: string): Promise<{ status: number; body: unknown }> {
  const res = await admin(`/iga/change-requests/${encodeURIComponent(id)}/approve`, { method: "POST", body: "{}" });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export function tidecloakBrowserBase(): { url: string; realm: string } {
  return { url: baseUrl(), realm: realm() };
}
