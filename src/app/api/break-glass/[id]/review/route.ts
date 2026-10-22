import { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json } from "@/lib/auth/caller";
import { reviewBreakGlass } from "@/lib/lifekey/breakglass.ts";
import { audit, nowSeconds, withStore } from "@/lib/lifekey/store.ts";

// Retrospective review by two approvers. A "not justified" flags the event for the privacy officer
// and is the trigger for taking er-attending away (a governed change, approved by the quorum).
export const POST = withAuth(async (req: NextRequest, jwt) => {
  const caller = callerFrom(jwt);
  if (!caller.isApprover) return json({ error: "approvers only" }, 403);
  const id = req.nextUrl.pathname.split("/").filter(Boolean).at(-2) ?? "";
  const body = await req.json();
  const decision = body.decision === "not_justified" ? "not_justified" : "justified";
  const out = await withStore((s) => {
    const event = s.breakGlass[id];
    if (!event) return { error: "no such event" };
    const r = reviewBreakGlass(event, { reviewer: caller.username, decision, note: String(body.note ?? "") }, nowSeconds());
    if ("error" in r) return r;
    s.breakGlass[id] = r.event;
    audit(s, { actor: caller.username, action: "break-glass.review", resource: event.recordId, outcome: decision === "justified" ? "ok" : "denied", detail: `${id}: ${decision} → ${r.event.status}` });
    return r;
  });
  if ("error" in out) return json(out, 400);
  return json(out);
});
