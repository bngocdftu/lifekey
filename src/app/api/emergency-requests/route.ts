import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json } from "@/lib/auth/caller";
import { ROLE_CLINICIAN, policyName } from "@/lib/lifekey/grants.ts";
import { createEmergencyRequest, effectiveStatus, requestGrant } from "@/lib/lifekey/requests.ts";
import { audit, nowSeconds, withStore } from "@/lib/lifekey/store.ts";
import { fileGrant, refreshRequests } from "@/lib/lifekey/sync.ts";

const DEFAULT_TTL_SECONDS = 2 * 3600;

// Doctor A asks to read one Tier 2 record. LifeKey files a policy naming A's key and that record
// for the admin quorum; nothing is readable until the quorum signs it.
export const POST = withAuth(async (req, jwt) => {
  const caller = callerFrom(jwt);
  if (!caller.realmRoles.includes(ROLE_CLINICIAN)) return json({ error: "clinicians only" }, 403);
  if (caller.isApprover) {
    // An approver asking for themselves would hold one of the votes on their own request.
    return json({ error: "approvers cannot request records; ask a clinician who is not on the quorum" }, 403);
  }
  const body = await req.json();
  try {
    const out = await withStore(async (s) => {
      const id = `REQ-${++s.counters.request}`;
      const created = createEmergencyRequest(
        {
          patientId: String(body.patientId ?? ""),
          recordId: String(body.recordId ?? ""),
          alertId: body.alertId ? String(body.alertId) : undefined,
          doctorUsername: caller.username,
          doctorKey: caller.tideUserKey,
          reason: String(body.reason ?? ""),
          ttlSeconds: Number(body.ttlSeconds ?? DEFAULT_TTL_SECONDS),
        },
        nowSeconds(),
        id,
        policyName,
      );
      if ("errors" in created) {
        audit(s, { actor: caller.username, action: "request.create", resource: String(body.recordId), outcome: "denied", detail: created.errors.join("; ") });
        return { errors: created.errors };
      }
      const r = created.request;
      const filed = await fileGrant(s, r.policyName, requestGrant(r), caller.username);
      s.requests[r.id] = { ...r, changeRequestId: filed.changeRequestId };
      audit(s, { actor: caller.username, action: "request.create", resource: r.recordId, outcome: "ok", detail: `${r.id} (${r.reason}) → CR ${filed.changeRequestId}` });
      return { request: s.requests[r.id] };
    });
    if ("errors" in out) return json(out, 400);
    return json(out, 201);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

export const GET = withAuth(async (_req, jwt) => {
  const caller = callerFrom(jwt);
  try {
    const requests = await withStore(async (s) => {
      await refreshRequests(s);
      const now = nowSeconds();
      return Object.values(s.requests)
        .filter((r) => caller.isApprover || r.doctorUsername === caller.username)
        .map((r) => ({ ...r, status: effectiveStatus(r, now) }))
        .sort((a, b) => b.createdAt - a.createdAt);
    });
    return json({ requests });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
