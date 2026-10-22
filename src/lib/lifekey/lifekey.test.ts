// Run: npm test
// These cover LifeKey's own rules. What the Tide network enforces is proved live on /proof.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RECORDS } from "./catalogue.ts";
import { policyMismatches, policyName, policyParams, standingGrants, validateGrant, type DescribedPolicy } from "./grants.ts";
import { applySignedPolicy, canApprove, createEmergencyRequest, effectiveStatus, requestDigest, type EmergencyRequest } from "./requests.ts";
import { declareBreakGlass, isOverdue, reviewBreakGlass, type BreakGlassEvent } from "./breakglass.ts";
import { appendAudit, verifyAuditChain, type AuditEntry } from "./audit.ts";
import { applyConsent, consentChanges, recordConsent, TIER0_MAX_LENGTH, type ConsentInput, type PatientConsent } from "./consent.ts";

const NOW = 1_800_000_000;
const A_KEY = "a-key-hex";

function newRequest(over: Partial<Parameters<typeof createEmergencyRequest>[0]> = {}) {
  return createEmergencyRequest(
    { patientId: "PAT-001", recordId: "MED-204", alertId: "ALERT-88", doctorUsername: "doctor-a", doctorKey: A_KEY, reason: "Emergency bleeding risk assessment", ttlSeconds: 3600, ...over },
    NOW,
    "REQ-1042",
    (spec, id) => policyName(spec, id),
  );
}

function pending(): EmergencyRequest {
  const r = newRequest();
  assert.ok("request" in r, JSON.stringify(r));
  return r.request;
}

function signedPolicyFor(r: EmergencyRequest, over: Partial<DescribedPolicy> = {}): DescribedPolicy {
  return { contractId: "RelationshipAttestation:1", subjectType: "User", subjectId: r.doctorKey, recordId: r.recordId, roles: '["_tide_decryptor"]', expiry: r.expiresAt, signed: true, ...over };
}

test("policy params are in sorted key order", () => {
  const keys = policyParams({ kind: "emergency-jit", subject: { type: "User", id: "k" }, recordId: "MED-204", access: "read", expiry: NOW + 60 }).map(([k]) => k);
  assert.deepEqual(keys, [...keys].sort());
});

test("standing grants: Tier 1 for clinicians, break-glass only for eligible Tier 2, recorder write-only", () => {
  const g = standingGrants(NOW);
  assert.ok(g.some((s) => s.kind === "tier1-standing" && s.recordId === "T1-PAT-001"));
  assert.deepEqual(g.filter((s) => s.kind === "break-glass-standing").map((s) => s.recordId), ["MED-204"]);
  assert.ok(g.filter((s) => s.kind === "recorder-write").every((s) => s.access === "write"));
  assert.equal(g.filter((s) => s.kind === "recorder-write").length, RECORDS.length);
  for (const s of g) assert.deepEqual(validateGrant(s, NOW), [], `${s.kind} ${s.recordId}`);
});

test("break-glass cannot be granted on Tier 3 or a non-eligible record", () => {
  for (const recordId of ["PSY-301", "MED-205"]) {
    const errs = validateGrant({ kind: "break-glass-standing", subject: { type: "Role", id: "er-attending" }, recordId, access: "read" }, NOW);
    assert.ok(errs.length > 0, recordId);
  }
});

test("emergency request: Tier 2 only, read-only, bounded expiry", () => {
  assert.ok("errors" in newRequest({ recordId: "PSY-301" }), "Tier 3 refused");
  assert.ok("errors" in newRequest({ recordId: "T1-PAT-001" }), "Tier 1 needs no request");
  assert.ok("errors" in newRequest({ ttlSeconds: 5 * 3600 }), "more than 4h refused");
  assert.ok("errors" in newRequest({ doctorKey: "" }), "no Tide key refused");
  assert.ok("errors" in newRequest({ reason: "pls" }), "no reason refused");
  assert.ok("request" in newRequest());
});

test("request becomes AUTHORIZED only when the signed policy matches", () => {
  const r = pending();
  assert.equal(applySignedPolicy(r, signedPolicyFor(r), NOW + 10).status, "AUTHORIZED");
  const cases: Partial<DescribedPolicy>[] = [
    { subjectId: "someone-else-key" },
    { recordId: "MED-205" },
    { roles: '["_tide_encryptor","_tide_decryptor"]' },
    { expiry: r.expiresAt + 86400 },
    { signed: false },
    { contractId: "SomethingElse:1" },
  ];
  for (const c of cases) {
    const out = applySignedPolicy(r, signedPolicyFor(r, c), NOW + 10);
    assert.equal(out.status, "FAILED_VALIDATION", JSON.stringify(c));
  }
});

test("editing a stored request after filing is detected", () => {
  const r = pending();
  const tampered = { ...r, recordId: "MED-205" };
  assert.notEqual(requestDigest(tampered), r.digest);
  assert.equal(applySignedPolicy(tampered, signedPolicyFor(tampered), NOW + 10).status, "FAILED_VALIDATION");
});

test("requester cannot approve their own request", () => {
  const r = pending();
  assert.ok(canApprove(r, "doctor-a"));
  assert.equal(canApprove(r, "doctor-b"), null);
});

test("authorized request expires by itself", () => {
  const r = applySignedPolicy(pending(), signedPolicyFor(pending()), NOW + 10);
  assert.equal(effectiveStatus(r, r.expiresAt - 1), "AUTHORIZED");
  assert.equal(effectiveStatus(r, r.expiresAt), "EXPIRED");
});

const BG = { id: "BG-1", patientId: "PAT-001", recordId: "MED-204", doctorUsername: "doctor-a", doctorKey: A_KEY, doctorRoles: ["er-attending"], reason: "Unconscious trauma patient, active bleeding" };

test("break-glass: eligible Tier 2 record, er-attending, real reason", () => {
  assert.ok("event" in declareBreakGlass(BG, [], NOW));
  assert.ok("errors" in declareBreakGlass({ ...BG, recordId: "PSY-301" }, [], NOW), "Tier 3");
  assert.ok("errors" in declareBreakGlass({ ...BG, recordId: "MED-205" }, [], NOW), "not pre-authorised");
  assert.ok("errors" in declareBreakGlass({ ...BG, doctorRoles: ["lifekey-clinician"] }, [], NOW), "not er-attending");
  assert.ok("errors" in declareBreakGlass({ ...BG, reason: "urgent" }, [], NOW), "no reason");
});

test("break-glass: rate limit pushes repeat use to the quorum path", () => {
  const history: BreakGlassEvent[] = [];
  for (let i = 0; i < 3; i++) {
    const r = declareBreakGlass({ ...BG, id: `BG-${i}` }, history, NOW + i);
    assert.ok("event" in r);
    history.push(r.event);
  }
  assert.ok("errors" in declareBreakGlass({ ...BG, id: "BG-4" }, history, NOW + 10));
  assert.ok("event" in declareBreakGlass({ ...BG, id: "BG-5" }, history, NOW + 25 * 3600));
});

test("break-glass review: two distinct reviewers, never the doctor, any objection flags it", () => {
  const d = declareBreakGlass(BG, [], NOW);
  assert.ok("event" in d);
  assert.ok("error" in reviewBreakGlass(d.event, { reviewer: "doctor-a", decision: "justified", note: "self" }, NOW));
  const one = reviewBreakGlass(d.event, { reviewer: "doctor-b", decision: "justified", note: "INR needed" }, NOW);
  assert.ok("event" in one);
  assert.equal(one.event.status, "AWAITING_REVIEW");
  assert.ok("error" in reviewBreakGlass(one.event, { reviewer: "doctor-b", decision: "justified", note: "again" }, NOW), "same reviewer twice");
  const two = reviewBreakGlass(one.event, { reviewer: "doctor-c", decision: "justified", note: "scope ok" }, NOW);
  assert.ok("event" in two);
  assert.equal(two.event.status, "JUSTIFIED");
  const flagged = reviewBreakGlass(one.event, { reviewer: "doctor-c", decision: "not_justified", note: "patient was conscious" }, NOW);
  assert.ok("event" in flagged);
  assert.equal(flagged.event.status, "FLAGGED");
  assert.equal(isOverdue(d.event, d.event.reviewDueAt + 1), true);
});

test("audit chain detects an edited or removed entry", () => {
  const log: AuditEntry[] = [];
  appendAudit(log, { actor: "doctor-a", action: "request.create", resource: "MED-204", outcome: "ok" }, NOW);
  appendAudit(log, { actor: "doctor-b", action: "request.approve", resource: "MED-204", outcome: "ok" }, NOW + 1);
  appendAudit(log, { actor: "doctor-a", action: "record.decrypt", resource: "MED-204", outcome: "ok" }, NOW + 2);
  assert.equal(verifyAuditChain(log), null);
  assert.equal(verifyAuditChain([log[0], log[2]]), 3, "entry 3 no longer follows entry 1");
  assert.equal(verifyAuditChain([log[0], { ...log[1], actor: "doctor-c" }, log[2]]), 2);
});

// ---- Patient consent (app-enforced; the quorum still signs the grants it leads to) ----

function consentFor(input: Partial<ConsentInput> = {}, username = "patient-alice", prev?: PatientConsent) {
  return recordConsent(prev, { breakGlass: ["MED-204"], tier0: { bloodType: "O+" }, ...input }, username, NOW);
}

test("consent: only the patient's own account signs it, and versions count up", () => {
  assert.ok("errors" in consentFor({}, "doctor-a"));
  const v1 = consentFor();
  assert.ok("consent" in v1, JSON.stringify(v1));
  assert.equal(v1.consent.patientId, "PAT-001");
  assert.equal(v1.consent.version, 1);
  const v2 = consentFor({ breakGlass: [] }, "patient-alice", v1.consent);
  assert.ok("consent" in v2);
  assert.equal(v2.consent.version, 2);
  assert.deepEqual(consentChanges(v1.consent, v2.consent), { added: [], removed: ["MED-204"] });
});

test("consent: break-glass only on the patient's Tier 2 records, never Tier 1 or Tier 3", () => {
  assert.ok("consent" in consentFor({ breakGlass: ["MED-204", "MED-205"] }));
  assert.ok("errors" in consentFor({ breakGlass: ["PSY-301"] }));
  assert.ok("errors" in consentFor({ breakGlass: ["T1-PAT-001"] }));
  assert.ok("errors" in consentFor({ breakGlass: ["NOPE-1"] }));
});

test("consent: emergency card keeps only known, non-empty, short fields", () => {
  const r = consentFor({ tier0: { bloodType: " O+ ", allergies: "", nickname: "x", implants: "y".repeat(500) } as never });
  assert.ok("consent" in r);
  assert.deepEqual(Object.keys(r.consent.tier0), ["bloodType", "implants"]);
  assert.equal(r.consent.tier0.bloodType, "O+");
  assert.ok(r.consent.tier0.implants!.length <= TIER0_MAX_LENGTH);
});

test("consent drives break-glass: no consent, no break-glass grant or declaration", () => {
  const none = applyConsent(RECORDS, undefined);
  assert.ok(none.every((r) => !r.breakGlassEligible));
  assert.ok(!standingGrants(NOW, none).some((g) => g.kind === "break-glass-standing"));

  const c = consentFor({ breakGlass: ["MED-205"] });
  assert.ok("consent" in c);
  const recs = applyConsent(RECORDS, c.consent);
  const bg = standingGrants(NOW, recs).filter((g) => g.kind === "break-glass-standing").map((g) => g.recordId);
  assert.deepEqual(bg, ["MED-205"]);
  assert.deepEqual(validateGrant({ kind: "break-glass-standing", subject: { type: "Role", id: "er-attending" }, recordId: "MED-205", access: "read", expiry: NOW + 60 }, NOW, recs), []);
  assert.ok(validateGrant({ kind: "break-glass-standing", subject: { type: "Role", id: "er-attending" }, recordId: "MED-204", access: "read", expiry: NOW + 60 }, NOW, recs).length > 0);

  const input = { id: "BG-9", patientId: "PAT-001", doctorUsername: "doctor-a", doctorKey: A_KEY, doctorRoles: ["er-attending"], reason: "Unconscious, bleeding, anticoagulant unknown" };
  assert.ok("errors" in declareBreakGlass({ ...input, recordId: "MED-204" }, [], NOW, recs));
  assert.ok("event" in declareBreakGlass({ ...input, recordId: "MED-205" }, [], NOW, recs));
});
