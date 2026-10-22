import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json } from "@/lib/auth/caller";
import { ROLE_PATIENT } from "@/lib/lifekey/grants.ts";
import { consentChanges, patientForAccount, recordConsent, type ConsentInput } from "@/lib/lifekey/consent.ts";
import { audit, nowSeconds, withStore } from "@/lib/lifekey/store.ts";

// The patient signs what they agree to, from their own account. LifeKey files only the grants the
// consent covers (/api/setup) and refuses break-glass the patient has not agreed to.
export const POST = withAuth(async (req, jwt) => {
  const caller = callerFrom(jwt);
  const patientId = patientForAccount(caller.username);
  if (!caller.realmRoles.includes(ROLE_PATIENT) || !patientId) return json({ error: "patients only" }, 403);
  const body = (await req.json()) as Partial<ConsentInput>;
  const out = await withStore((s) => {
    const prev = s.consents[patientId];
    const r = recordConsent(prev, { breakGlass: body.breakGlass ?? [], tier0: body.tier0 ?? {} }, caller.username, nowSeconds());
    if ("errors" in r) {
      audit(s, { actor: caller.username, action: "consent.sign", resource: patientId, outcome: "denied", detail: r.errors.join("; ") });
      return r;
    }
    const { added, removed } = consentChanges(prev, r.consent);
    s.consents[patientId] = r.consent;
    audit(s, {
      actor: caller.username,
      action: "consent.sign",
      resource: patientId,
      outcome: "ok",
      detail: `v${r.consent.version}: mở khẩn cấp ${r.consent.breakGlass.join(", ") || "không hồ sơ nào"}`
        + (added.length ? `; thêm ${added.join(", ")}` : "")
        + (removed.length ? `; rút ${removed.join(", ")}` : "")
        + `; thẻ khẩn cấp: ${Object.keys(r.consent.tier0).join(", ") || "trống"}`,
    });
    // A grant already signed for a withdrawn record stays valid on the network until it expires.
    const stillSigned = removed.filter((id) => Object.values(s.policies).some((p) => p.spec.kind === "break-glass-standing" && p.spec.recordId === id && p.status === "SIGNED"));
    return { consent: r.consent, added, removed, stillSigned };
  });
  if ("errors" in out) return json(out, 400);
  return json(out, 201);
});
