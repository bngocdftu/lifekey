import { NextRequest } from "next/server";
import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json } from "@/lib/auth/caller";
import { PATIENT, RECORDS } from "@/lib/lifekey/catalogue.ts";
import { ROLE_CLINICIAN, ROLE_RECORDER } from "@/lib/lifekey/grants.ts";
import { audit, readStore, withStore } from "@/lib/lifekey/store.ts";

// What scanning the QR resolves to: record metadata and ciphertext. Never plaintext.
//
// Ciphertext is handed to any signed-in clinician on purpose: it is useless without a policy the
// network honours, and /proof relies on that to show the NETWORK refusing, not this server.
export const GET = withAuth(async (req: NextRequest, jwt) => {
  const caller = callerFrom(jwt);
  if (!caller.realmRoles.includes(ROLE_CLINICIAN) && !caller.realmRoles.includes(ROLE_RECORDER)) {
    return json({ error: "clinicians only" }, 403);
  }
  const publicId = req.nextUrl.pathname.split("/").filter(Boolean).pop();
  if (publicId !== PATIENT.publicId) {
    // Case C: nobody to match. Say so; do not guess a history.
    return json({ found: false, message: "No previous medical records available" }, 404);
  }
  await withStore((s) => audit(s, { actor: caller.username, action: "patient.lookup", resource: PATIENT.id, outcome: "ok", detail: "via QR public id" }));
  const store = readStore();
  return json({
    found: true,
    patient: PATIENT,
    records: RECORDS.map((r) => ({ ...r, ciphertext: store.ciphertexts[r.id]?.ciphertext ?? null })),
  });
});
