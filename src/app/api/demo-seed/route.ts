import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json } from "@/lib/auth/caller";
import { PATIENT } from "@/lib/lifekey/catalogue.ts";
import { policyName } from "@/lib/lifekey/grants.ts";
import { createEmergencyRequest, requestGrant, type NewRequestInput } from "@/lib/lifekey/requests.ts";
import { declareBreakGlass } from "@/lib/lifekey/breakglass.ts";
import { audit, consentedRecords, nowSeconds, withStore, type StoreShape } from "@/lib/lifekey/store.ts";
import { fileGrant } from "@/lib/lifekey/sync.ts";

// DEMO ONLY, off unless LIFEKEY_DEMO_SEED=1. Files the requests a demo starts from, so every role
// has something on screen: two requests from Doctor A and one from the patient, plus a break-glass
// if the patient's consent allows it. Each is filed for the real admin quorum and marked in the log
// as made by "demo-seed" on that person's behalf. Nothing here signs, approves or consents.
const enabled = () => process.env.LIFEKEY_DEMO_SEED === "1";

const SEED: { who: string; input: Omit<NewRequestInput, "doctorUsername" | "doctorKey"> }[] = [
  { who: "doctor-a", input: { patientId: PATIENT.id, recordId: "MED-204", alertId: "ALERT-88", reason: "Assess bleeding risk before suturing the wound", ttlSeconds: 2 * 3600 } },
  { who: "doctor-a", input: { patientId: PATIENT.id, recordId: "MED-205", alertId: "ALERT-89", reason: "Check the heart valve type before an MRI scan", ttlSeconds: 2 * 3600 } },
  { who: "patient-alice", input: { patientId: PATIENT.id, recordId: "T1-PAT-001", reason: "I want to review my emergency summary", ttlSeconds: 2 * 3600, purpose: "patient-self" } },
];

export const GET = withAuth(async () => json({ enabled: enabled() }));

export const POST = withAuth(async (_req, jwt) => {
  const caller = callerFrom(jwt);
  if (!enabled()) return json({ error: "demo seeding is off (set LIFEKEY_DEMO_SEED=1)" }, 403);
  if (!caller.isApprover) return json({ error: "a tide-realm-admin seeds the demo" }, 403);
  try {
    const out = await withStore(async (s: StoreShape) => {
      const created: string[] = [];
      const skipped: string[] = [];
      for (const { who, input } of SEED) {
        const key = s.users[who]?.tideUserKey;
        if (!key) { skipped.push(`${input.recordId} (${who}): ${who} has never signed in, so there is no Tide key yet`); continue; }
        const open = Object.values(s.requests).some((r) => r.doctorUsername === who && r.recordId === input.recordId && (r.status === "PENDING_APPROVAL" || r.status === "AUTHORIZED"));
        if (open) { skipped.push(`${input.recordId} (${who}): a request is already open`); continue; }
        const id = `REQ-${++s.counters.request}`;
        const r = createEmergencyRequest({ ...input, doctorUsername: who, doctorKey: key }, nowSeconds(), id, policyName);
        if ("errors" in r) { s.counters.request--; skipped.push(`${input.recordId} (${who}): ${r.errors.join("; ")}`); continue; }
        const filed = await fileGrant(s, r.request.policyName, requestGrant(r.request), "demo-seed");
        s.requests[id] = { ...r.request, changeRequestId: filed.changeRequestId };
        audit(s, { actor: "demo-seed", action: "request.create", resource: input.recordId, outcome: "ok", detail: `Sample data: ${id} created for ${who} → CR ${filed.changeRequestId}` });
        created.push(`${id} · ${input.recordId} · ${who}`);
      }
      const a = s.users["doctor-a"];
      const eligible = consentedRecords(s).find((r) => r.id === "MED-204")?.breakGlassEligible;
      if (!a) skipped.push("Break-glass: doctor-a has not signed in");
      else if (!eligible) skipped.push("Break-glass: the patient has not allowed break-glass on MED-204");
      else if (Object.values(s.breakGlass).some((e) => e.doctorUsername === "doctor-a" && e.status === "AWAITING_REVIEW")) skipped.push("Break-glass: one is already awaiting review");
      else {
        const id = `BG-${++s.counters.breakGlass}`;
        const d = declareBreakGlass({ id, patientId: PATIENT.id, recordId: "MED-204", doctorUsername: "doctor-a", doctorKey: a.tideUserKey, doctorRoles: a.roles, reason: "Patient unconscious and bleeding; need to know the anticoagulant" }, Object.values(s.breakGlass), nowSeconds(), consentedRecords(s));
        if ("errors" in d) { s.counters.breakGlass--; skipped.push(`Break-glass: ${d.errors.join("; ")}`); }
        else {
          s.breakGlass[id] = d.event;
          audit(s, { actor: "demo-seed", action: "break-glass.declare", resource: "MED-204", outcome: "ok", detail: `Sample data: ${id} declared for doctor-a` });
          created.push(`${id} · MED-204 · break-glass`);
        }
      }
      return { created, skipped };
    });
    return json(out, 201);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
