import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json } from "@/lib/auth/caller";
import { declareBreakGlass, isOverdue } from "@/lib/lifekey/breakglass.ts";
import { audit, nowSeconds, withStore } from "@/lib/lifekey/store.ts";

// Declare break-glass. The policy is released by /api/policies?purpose=break-glass afterwards, and
// only for one hour after declaring.
export const POST = withAuth(async (req, jwt) => {
  const caller = callerFrom(jwt);
  const body = await req.json();
  const out = await withStore((s) => {
    const id = `BG-${++s.counters.breakGlass}`;
    const r = declareBreakGlass(
      {
        id,
        patientId: String(body.patientId ?? ""),
        recordId: String(body.recordId ?? ""),
        doctorUsername: caller.username,
        doctorKey: caller.tideUserKey,
        doctorRoles: caller.realmRoles,
        reason: String(body.reason ?? ""),
      },
      Object.values(s.breakGlass),
      nowSeconds(),
    );
    if ("errors" in r) {
      audit(s, { actor: caller.username, action: "break-glass.declare", resource: String(body.recordId), outcome: "denied", detail: r.errors.join("; ") });
      return r;
    }
    s.breakGlass[id] = r.event;
    audit(s, { actor: caller.username, action: "break-glass.declare", resource: r.event.recordId, outcome: "ok", detail: `${id}: ${r.event.reason}. Notified: ${r.event.notified.join(", ")}` });
    return r;
  });
  if ("errors" in out) return json(out, 400);
  return json(out, 201);
});

export const GET = withAuth(async (_req, jwt) => {
  const caller = callerFrom(jwt);
  const now = nowSeconds();
  const events = await withStore((s) =>
    Object.values(s.breakGlass)
      .filter((e) => caller.isApprover || e.doctorUsername === caller.username)
      .map((e) => ({ ...e, overdue: isOverdue(e, now) }))
      .sort((a, b) => b.declaredAt - a.declaredAt),
  );
  return json({ events });
});
