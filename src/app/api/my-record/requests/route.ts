import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json } from "@/lib/auth/caller";
import { ROLE_PATIENT, policyName } from "@/lib/lifekey/grants.ts";
import { patientForAccount } from "@/lib/lifekey/consent.ts";
import { createEmergencyRequest, requestGrant } from "@/lib/lifekey/requests.ts";
import { audit, nowSeconds, withStore } from "@/lib/lifekey/store.ts";
import { fileGrant } from "@/lib/lifekey/sync.ts";

const TTL_SECONDS = 2 * 3600;

// The patient asks to read one of their own records. Same path as a doctor's request: a policy
// naming the patient's own Tide key and that record, signed by the admin quorum, checked by the ORKs.
export const POST = withAuth(async (req, jwt) => {
  const caller = callerFrom(jwt);
  const patientId = patientForAccount(caller.username);
  if (!caller.realmRoles.includes(ROLE_PATIENT) || !patientId) return json({ error: "patients only" }, 403);
  const body = await req.json();
  try {
    const out = await withStore(async (s) => {
      const id = `REQ-${++s.counters.request}`;
      const created = createEmergencyRequest(
        { patientId, recordId: String(body.recordId ?? ""), doctorUsername: caller.username, doctorKey: caller.tideUserKey, reason: String(body.reason ?? ""), ttlSeconds: TTL_SECONDS, purpose: "patient-self" },
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
      audit(s, { actor: caller.username, action: "request.create", resource: r.recordId, outcome: "ok", detail: `${r.id} patient asked to view (${r.reason}) → CR ${filed.changeRequestId}` });
      return { request: s.requests[r.id] };
    });
    if ("errors" in out) return json(out, 400);
    return json(out, 201);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
