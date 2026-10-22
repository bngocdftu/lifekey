import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json } from "@/lib/auth/caller";
import { policyName, standingGrants } from "@/lib/lifekey/grants.ts";
import { PATIENT } from "@/lib/lifekey/catalogue.ts";
import { consentedRecords, nowSeconds, readStore, withStore } from "@/lib/lifekey/store.ts";
import { fileGrant, refreshGrant } from "@/lib/lifekey/sync.ts";

// Enrollment: file every standing grant (Tier 1, recorder write-only, break-glass) for the quorum.
// Only after the patient signed their consent, and only the break-glass grants it covers. Run
// again after the patient adds a record: grants already filed are kept (fileGrant is idempotent).
export const POST = withAuth(async (_req, jwt) => {
  const caller = callerFrom(jwt);
  if (!caller.isApprover) return json({ error: "a tide-realm-admin starts enrollment" }, 403);
  try {
    const filed = await withStore(async (s) => {
      if (!s.consents[PATIENT.id]) return null;
      const out = [];
      for (const spec of standingGrants(nowSeconds(), consentedRecords(s))) out.push(await fileGrant(s, policyName(spec), spec, caller.username));
      return out;
    });
    if (!filed) return json({ error: "the patient has not signed their consent yet" }, 409);
    return json({ policies: filed });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

export const GET = withAuth(async () => {
  try {
    const policies = await withStore(async (s) => {
      for (const name of Object.keys(s.policies)) {
        if (s.policies[name].spec.kind !== "emergency-jit") await refreshGrant(s, name);
      }
      return Object.values(s.policies).filter((p) => p.spec.kind !== "emergency-jit");
    });
    const store = readStore();
    const consent = store.consents[PATIENT.id] ?? null;
    // Grants the consent calls for that have not been filed yet (e.g. the patient added a record).
    const toFile = consent ? standingGrants(nowSeconds(), consentedRecords(store)).filter((g) => !store.policies[policyName(g)]).length : 0;
    return json({
      policies: policies.map(({ policyB64, ...p }) => ({ ...p, signed: !!policyB64 })),
      ciphertexts: Object.keys(store.ciphertexts),
      consent,
      toFile,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
