import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json } from "@/lib/auth/caller";
import { PATIENT } from "@/lib/lifekey/catalogue.ts";
import { ROLE_PATIENT } from "@/lib/lifekey/grants.ts";
import { patientForAccount } from "@/lib/lifekey/consent.ts";
import { isOverdue } from "@/lib/lifekey/breakglass.ts";
import { effectiveStatus } from "@/lib/lifekey/requests.ts";
import { consentedRecords, nowSeconds, withStore } from "@/lib/lifekey/store.ts";
// Ciphertext is not a secret here either: it opens only with a policy naming the patient's key.
import { refreshRequests } from "@/lib/lifekey/sync.ts";

// The patient's own view: their consent, who asked for or opened which record, and what grants
// exist. Metadata only. The patient holds no policy, so this never includes record content.
export const GET = withAuth(async (_req, jwt) => {
  const caller = callerFrom(jwt);
  const patientId = patientForAccount(caller.username);
  if (!caller.realmRoles.includes(ROLE_PATIENT) || !patientId) return json({ error: "patients only" }, 403);
  try {
    const out = await withStore(async (s) => {
      await refreshRequests(s);
      const now = nowSeconds();
      const records = consentedRecords(s).filter((r) => r.patientId === patientId);
      const ids = new Set([...records.map((r) => r.id), patientId]);
      return {
        patient: PATIENT,
        consent: s.consents[patientId] ?? null,
        records: records.map((r) => ({ ...r, stored: !!s.ciphertexts[r.id], ciphertext: s.ciphertexts[r.id]?.ciphertext ?? null })),
        requests: Object.values(s.requests)
          .filter((r) => r.patientId === patientId)
          .map((r) => ({ id: r.id, purpose: r.purpose ?? "clinical", recordId: r.recordId, doctorUsername: r.doctorUsername, reason: r.reason, createdAt: r.createdAt, expiresAt: r.expiresAt, status: effectiveStatus(r, now), clarifications: r.clarifications ?? [] }))
          .sort((a, b) => b.createdAt - a.createdAt),
        breakGlass: Object.values(s.breakGlass)
          .filter((e) => e.patientId === patientId)
          .map(({ doctorKey: _k, ...e }) => ({ ...e, overdue: isOverdue({ ...e, doctorKey: _k }, now) }))
          .sort((a, b) => b.declaredAt - a.declaredAt),
        standing: Object.values(s.policies)
          .filter((p) => p.spec.kind !== "emergency-jit" && ids.has(p.spec.recordId))
          .map((p) => ({ name: p.name, kind: p.spec.kind, recordId: p.spec.recordId, subject: p.spec.subject.id, access: p.spec.access, expiry: p.spec.expiry, status: p.status })),
        audit: [...s.audit].reverse().filter((e) => ids.has(e.resource)).slice(0, 200),
      };
    });
    return json(out);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
