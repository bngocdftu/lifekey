import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json } from "@/lib/auth/caller";
import { ROLE_PATIENT } from "@/lib/lifekey/grants.ts";
import { patientForAccount } from "@/lib/lifekey/consent.ts";
import { objectToBreakGlass } from "@/lib/lifekey/breakglass.ts";
import { audit, nowSeconds, withStore } from "@/lib/lifekey/store.ts";

// The patient tells the reviewers a break-glass on their record was not needed.
export const POST = withAuth(async (req, jwt) => {
  const caller = callerFrom(jwt);
  const patientId = patientForAccount(caller.username);
  if (!caller.realmRoles.includes(ROLE_PATIENT) || !patientId) return json({ error: "patients only" }, 403);
  const body = await req.json();
  const out = await withStore((s) => {
    const event = s.breakGlass[String(body.eventId ?? "")];
    if (!event) return { error: "no such event" };
    const r = objectToBreakGlass(event, patientId, String(body.note ?? ""), nowSeconds());
    if ("error" in r) return r;
    s.breakGlass[event.id] = r.event;
    audit(s, { actor: caller.username, action: "break-glass.objection", resource: event.recordId, outcome: "info", detail: `${event.id}: ${r.event.patientObjection!.note}` });
    return { event: r.event };
  });
  if ("error" in out) return json(out, 400);
  return json(out, 201);
});
