import { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json } from "@/lib/auth/caller";
import { findRecord } from "@/lib/lifekey/catalogue.ts";
import { ROLE_RECORDER } from "@/lib/lifekey/grants.ts";
import { audit, nowSeconds, withStore } from "@/lib/lifekey/store.ts";

function recordIdFrom(req: NextRequest) {
  return req.nextUrl.pathname.split("/").filter(Boolean).pop() ?? "";
}

// The records officer stores ciphertext produced in their own browser.
export const PUT = withAuth(async (req, jwt) => {
  const caller = callerFrom(jwt);
  if (!caller.realmRoles.includes(ROLE_RECORDER)) return json({ error: "records officer only" }, 403);
  const recordId = recordIdFrom(req);
  if (!findRecord(recordId)) return json({ error: "unknown record" }, 404);
  const { ciphertext } = await req.json();
  if (typeof ciphertext !== "string" || ciphertext.length < 16) return json({ error: "ciphertext required" }, 400);
  // Refuse anything carrying the seed's field names: plaintext must never be stored.
  if (/"(patient|medications|procedures|alerts|note)"\s*:/.test(ciphertext)) {
    return json({ error: "that looks like plaintext, not ciphertext" }, 400);
  }
  await withStore((s) => {
    s.ciphertexts[recordId] = { recordId, ciphertext, writtenBy: caller.username, at: nowSeconds() };
    audit(s, { actor: caller.username, action: "record.write", resource: recordId, outcome: "ok", detail: `${ciphertext.length} chars of ciphertext` });
  });
  return json({ ok: true });
});
