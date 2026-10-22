import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json } from "@/lib/auth/caller";
import { findRecord } from "@/lib/lifekey/catalogue.ts";
import { rolesFor } from "@/lib/lifekey/grants.ts";
import { canApprove } from "@/lib/lifekey/requests.ts";
import { readStore } from "@/lib/lifekey/store.ts";
import { getChangeRequest, tidecloakBrowserBase } from "@/lib/tide/igaServer";

// What an approver needs to decide: the LifeKey context (who, which record, why, until when) next
// to the change request it belongs to. The approval itself goes from the approver's browser
// straight to TideCloak with their own token; this route never approves anything.
export const GET = withAuth(async (_req, jwt) => {
  const caller = callerFrom(jwt);
  if (!caller.isApprover) return json({ error: "approvers only" }, 403);
  const s = readStore();
  try {
    const items = [];
    for (const p of Object.values(s.policies)) {
      if (p.status !== "PENDING_QUORUM" || !p.changeRequestId) continue;
      const cr = await getChangeRequest(p.changeRequestId);
      const request = Object.values(s.requests).find((r) => r.policyName === p.name);
      const record = findRecord(p.spec.recordId);
      items.push({
        policyName: p.name,
        changeRequestId: p.changeRequestId,
        kind: p.spec.kind,
        recordId: p.spec.recordId,
        recordTitle: record?.title,
        tier: record?.tier,
        subject: p.spec.subject.type === "User" ? { type: "User", username: request?.doctorUsername ?? "?" } : p.spec.subject,
        roles: rolesFor(p.spec.access),
        expiry: p.spec.expiry,
        request: request && { id: request.id, reason: request.reason, alertId: request.alertId, doctorUsername: request.doctorUsername, createdAt: request.createdAt, digest: request.digest },
        blockedReason: request ? canApprove(request, caller.username) : null,
        changeRequest: cr && { status: cr.status, authorizationCount: cr.authorizationCount, threshold: cr.threshold, readyToCommit: cr.readyToCommit, authorizers: cr.authorizers },
      });
    }
    return json({ items, tidecloak: tidecloakBrowserBase() });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
