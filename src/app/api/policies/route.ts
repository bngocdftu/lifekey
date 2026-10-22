import { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json, type Caller } from "@/lib/auth/caller";
import { ROLE_CLINICIAN, ROLE_ER_ATTENDING, ROLE_RECORDER, type GrantKind } from "@/lib/lifekey/grants.ts";
import { effectiveStatus } from "@/lib/lifekey/requests.ts";
import { audit, consentedRecords, nowSeconds, withStore, type StoreShape } from "@/lib/lifekey/store.ts";
import { refreshRequests } from "@/lib/lifekey/sync.ts";

// Hand the caller the signed policy for a record and purpose.
//
// This is NOT the security boundary: a policy only works for the subject it names, and the ORKs
// check that on every decrypt (/proof shows a leaked policy failing). It is where LifeKey decides
// what to log and what to refuse to hand out early, e.g. break-glass before it was declared.

type Purpose = "tier1" | "write" | "break-glass" | "request";

function find(s: StoreShape, kind: GrantKind, recordId: string) {
  return Object.values(s.policies).find((p) => p.spec.kind === kind && p.spec.recordId === recordId && p.status === "SIGNED");
}

function pick(s: StoreShape, caller: Caller, purpose: Purpose, recordId: string, requestId: string | null): { policy?: string; error?: string; status?: number } {
  const now = nowSeconds();
  switch (purpose) {
    case "tier1": {
      if (!caller.realmRoles.includes(ROLE_CLINICIAN)) return { error: "clinicians only", status: 403 };
      return { policy: find(s, "tier1-standing", recordId)?.policyB64 };
    }
    case "write": {
      if (!caller.realmRoles.includes(ROLE_RECORDER)) return { error: "records officer only", status: 403 };
      return { policy: find(s, "recorder-write", recordId)?.policyB64 };
    }
    case "break-glass": {
      if (!caller.realmRoles.includes(ROLE_ER_ATTENDING)) return { error: "er-attending only", status: 403 };
      // A withdrawn consent stops LifeKey handing the policy out at once. The signed policy itself
      // stays valid on the network until it expires (no per-record revocation exists).
      if (!consentedRecords(s).find((r) => r.id === recordId)?.breakGlassEligible) return { error: "the patient has withdrawn break-glass for this record", status: 403 };
      const declared = Object.values(s.breakGlass).find((e) => e.doctorUsername === caller.username && e.recordId === recordId && now - e.declaredAt < 3600);
      if (!declared) return { error: "declare break-glass first (reason, notification, review)", status: 409 };
      return { policy: find(s, "break-glass-standing", recordId)?.policyB64 };
    }
    case "request": {
      const r = requestId ? s.requests[requestId] : undefined;
      if (!r || r.recordId !== recordId) return { error: "no such request for this record", status: 404 };
      if (r.doctorUsername !== caller.username) return { error: "this request names another doctor", status: 403 };
      const status = effectiveStatus(r, now);
      if (status !== "AUTHORIZED") return { error: `request is ${status}`, status: 409 };
      return { policy: s.policies[r.policyName]?.policyB64 };
    }
  }
}

export const GET = withAuth(async (req: NextRequest, jwt) => {
  const caller = callerFrom(jwt);
  const purpose = req.nextUrl.searchParams.get("purpose") as Purpose;
  const recordId = req.nextUrl.searchParams.get("record") ?? "";
  const requestId = req.nextUrl.searchParams.get("request");
  if (!["tier1", "write", "break-glass", "request"].includes(purpose)) return json({ error: "bad purpose" }, 400);

  const out = await withStore(async (s) => {
    if (purpose === "request") await refreshRequests(s);
    const r = pick(s, caller, purpose, recordId, requestId);
    audit(s, {
      actor: caller.username,
      action: `policy.release.${purpose}`,
      resource: recordId,
      outcome: r.policy ? "ok" : "denied",
      detail: r.error ?? (r.policy ? undefined : "no signed policy yet"),
    });
    return r;
  });
  if (out.error) return json({ error: out.error }, out.status ?? 400);
  if (!out.policy) return json({ error: "no signed policy for this yet: has the quorum approved it?" }, 404);
  return json({ policy: out.policy });
});
