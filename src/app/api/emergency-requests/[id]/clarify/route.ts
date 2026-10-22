import { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json } from "@/lib/auth/caller";
import { askClarification } from "@/lib/lifekey/requests.ts";
import { audit, nowSeconds, withStore } from "@/lib/lifekey/store.ts";

// An approver asks the requester for more detail before signing. The question is shown to the
// requester; it never changes what the request grants (it is outside the digest).
export const POST = withAuth(async (req: NextRequest, jwt) => {
  const caller = callerFrom(jwt);
  if (!caller.isApprover) return json({ error: "approvers only" }, 403);
  const id = req.nextUrl.pathname.split("/").filter(Boolean).at(-2) ?? "";
  const body = await req.json();
  const out = await withStore((s) => {
    const r = s.requests[id];
    if (!r) return { error: "no such request" };
    const asked = askClarification(r, caller.username, String(body.text ?? ""), nowSeconds());
    if ("error" in asked) return asked;
    s.requests[id] = asked.request;
    audit(s, { actor: caller.username, action: "request.clarify", resource: r.recordId, outcome: "info", detail: `${id}: ${asked.request.clarifications!.at(-1)!.text}` });
    return asked;
  });
  if ("error" in out) return json(out, 400);
  return json(out, 201);
});
