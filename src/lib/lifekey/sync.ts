// Server-only glue between LifeKey's store and TideCloak's IGA API.

import { buildUnsignedPolicyB64, describePolicyB64 } from "@/lib/tide/policyBytes";
import { fileJitPolicy, getChangeRequest, getSignedPolicy, vendorId } from "@/lib/tide/igaServer";
import { policyMismatches, type GrantSpec } from "./grants.ts";
import { applySignedPolicy } from "./requests.ts";
import { audit, nowSeconds, type StoreShape, type StoredPolicy } from "./store.ts";

/** Build the unsigned policy for a grant and raise the change request that gets it signed. */
export async function fileGrant(s: StoreShape, name: string, spec: GrantSpec, actor: string): Promise<StoredPolicy> {
  const existing = s.policies[name];
  if (existing && existing.status !== "FAILED") return existing;
  const unsigned = buildUnsignedPolicyB64(spec, vendorId());
  const { changeRequestId } = await fileJitPolicy(name, unsigned);
  const stored: StoredPolicy = { name, spec, changeRequestId, status: "PENDING_QUORUM" };
  s.policies[name] = stored;
  audit(s, { actor, action: "grant.file", resource: spec.recordId, outcome: "ok", detail: `${spec.kind} → CR ${changeRequestId}` });
  return stored;
}

/** Pull the signed policy once the quorum has approved, and check it says what was filed. */
export async function refreshGrant(s: StoreShape, name: string): Promise<StoredPolicy | undefined> {
  const p = s.policies[name];
  if (!p || p.status !== "PENDING_QUORUM") return p;
  const signed = await getSignedPolicy(name);
  if (!signed) {
    const cr = p.changeRequestId ? await getChangeRequest(p.changeRequestId) : null;
    if (cr && (cr.status === "DENIED" || cr.status === "CANCELLED")) {
      p.status = "FAILED";
      p.statusReason = `change request ${cr.status.toLowerCase()} by the quorum`;
      audit(s, { actor: "lifekey-server", action: "grant.denied", resource: p.spec.recordId, outcome: "denied", detail: `${p.spec.kind}: ${p.statusReason}` });
    }
    return p;
  }
  const mismatches = policyMismatches(p.spec, describePolicyB64(signed.policyB64));
  if (mismatches.length) {
    p.status = "FAILED";
    p.statusReason = `signed policy does not match the grant: ${mismatches.join("; ")}`;
    audit(s, { actor: "lifekey-server", action: "grant.verify", resource: p.spec.recordId, outcome: "error", detail: p.statusReason });
  } else {
    p.status = "SIGNED";
    p.policyB64 = signed.policyB64;
    audit(s, { actor: "lifekey-server", action: "grant.signed", resource: p.spec.recordId, outcome: "ok", detail: `${p.spec.kind} signed by the admin quorum` });
  }
  return p;
}

/** Bring every pending request up to date with its policy. */
export async function refreshRequests(s: StoreShape) {
  for (const r of Object.values(s.requests)) {
    if (r.status !== "PENDING_APPROVAL") continue;
    const p = await refreshGrant(s, r.policyName);
    if (p?.status === "SIGNED" && p.policyB64) {
      const next = applySignedPolicy(r, describePolicyB64(p.policyB64), nowSeconds());
      if (next.status !== r.status) {
        s.requests[r.id] = next;
        audit(s, { actor: "lifekey-server", action: "request.status", resource: r.recordId, outcome: next.status === "AUTHORIZED" ? "ok" : "error", detail: `${r.id} → ${next.status}${next.statusReason ? `: ${next.statusReason}` : ""}` });
      }
    } else if (p?.status === "FAILED") {
      const denied = p.statusReason?.startsWith("change request");
      s.requests[r.id] = { ...r, status: denied ? "DENIED" : "FAILED_VALIDATION", statusReason: p.statusReason };
    }
  }
}
