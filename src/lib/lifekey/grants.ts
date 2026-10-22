// Every grant LifeKey asks the Tide network to enforce, as data.
//
// A grant is one RelationshipAttestation:1 policy: one subject, one record, one set of operations.
// Building and signing the policy bytes happens elsewhere (src/lib/tide/); this file decides WHAT
// is granted, so the same rules drive the server, the approver screen and the tests.

import { RECORDS, type RecordMeta } from "./catalogue.ts";

export const ENCRYPT_ROLE = "_tide_encryptor";
export const DECRYPT_ROLE = "_tide_decryptor";

/** Realm roles LifeKey uses as policy subjects. */
export const ROLE_CLINICIAN = "lifekey-clinician";
export const ROLE_ER_ATTENDING = "er-attending";
export const ROLE_RECORDER = "lifekey-recorder";
/** A patient: signs their own consent and sees who opened their records. Never a policy subject. */
export const ROLE_PATIENT = "lifekey-patient";

export type Access = "read" | "write";

export type GrantKind =
  /** Every verified clinician may read the patient's Tier 1 summary. Pre-approved at enrollment. */
  | "tier1-standing"
  /** The records officer may write (not read) a record. */
  | "recorder-write"
  /** ER attendings may read a record the patient made break-glass eligible. Pre-approved. */
  | "break-glass-standing"
  /** One named doctor may read one record until the expiry. Approved by the quorum per request. */
  | "emergency-jit";

export type Subject = { type: "User"; id: string } | { type: "Role"; id: string };

export interface GrantSpec {
  kind: GrantKind;
  subject: Subject;
  recordId: string;
  access: Access;
  /** Epoch seconds. Required for emergency-jit. */
  expiry?: number;
}

/** Longest a per-request grant may live. A short grant is the only per-record revocation there is. */
export const MAX_JIT_SECONDS = 4 * 3600;

/**
 * Standing grants run for a bounded time too, so a forgotten one cannot live forever. They are
 * re-signed by the quorum when they lapse.
 */
export const STANDING_GRANT_SECONDS = 30 * 24 * 3600;

export function rolesFor(access: Access): string[] {
  return access === "read" ? [DECRYPT_ROLE] : [ENCRYPT_ROLE];
}

/**
 * Policy params in sorted key order. The ORK reconstructs parameters sorted, and a policy is
 * signed over its bytes, so building it in any other order risks a signature over different bytes
 * than the network checks (see IgaJitPolicyService in tidecloak-iga-extensions).
 */
export function policyParams(spec: GrantSpec): [string, string][] {
  const params: [string, string][] = [
    ["assignmentId", spec.recordId],
    ["roles", JSON.stringify(rolesFor(spec.access))],
    ["subjectId", spec.subject.id],
    ["subjectType", spec.subject.type],
  ];
  return params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Stable name the signed policy is stored under in TideCloak (IGA_ROLE_POLICY). */
export function policyName(spec: GrantSpec, requestId?: string): string {
  const who = spec.subject.type === "Role" ? `role-${spec.subject.id}` : "user";
  const base = `lk-${spec.kind}-${spec.recordId}-${who}-${spec.access}`;
  return requestId ? `${base}-${requestId}` : base;
}

/** `records` carries the patient's consent (applyConsent); without it, the catalogue defaults. */
export function validateGrant(spec: GrantSpec, now: number, records: RecordMeta[] = RECORDS): string[] {
  const errors: string[] = [];
  const record = records.find((r) => r.id === spec.recordId);
  if (!record) return [`unknown record ${spec.recordId}`];
  if (!spec.subject.id) errors.push("subject id is required");

  switch (spec.kind) {
    case "tier1-standing":
      if (record.tier !== 1) errors.push("tier1-standing grants only Tier 1 records");
      if (spec.access !== "read") errors.push("tier1-standing is read-only");
      if (spec.subject.type !== "Role" || spec.subject.id !== ROLE_CLINICIAN) errors.push(`tier1-standing is for role ${ROLE_CLINICIAN}`);
      break;
    case "recorder-write":
      if (spec.access !== "write") errors.push("recorder-write is write-only: the recorder must not read records back");
      if (spec.subject.type !== "Role" || spec.subject.id !== ROLE_RECORDER) errors.push(`recorder-write is for role ${ROLE_RECORDER}`);
      break;
    case "break-glass-standing":
      if (record.tier !== 2) errors.push("break-glass covers Tier 2 only; Tier 3 needs its own legal basis");
      if (!record.breakGlassEligible) errors.push(`patient did not make ${record.id} break-glass eligible`);
      if (spec.access !== "read") errors.push("break-glass is read-only");
      if (spec.subject.type !== "Role" || spec.subject.id !== ROLE_ER_ATTENDING) errors.push(`break-glass is for role ${ROLE_ER_ATTENDING}`);
      break;
    case "emergency-jit":
      if (record.tier !== 2) errors.push("an emergency request opens Tier 2 records only");
      if (spec.access !== "read") errors.push("an emergency request is read-only");
      if (spec.subject.type !== "User") errors.push("an emergency request names one doctor");
      if (!spec.expiry) errors.push("an emergency request needs an expiry");
      else if (spec.expiry <= now) errors.push("expiry is in the past");
      else if (spec.expiry - now > MAX_JIT_SECONDS) errors.push(`expiry is more than ${MAX_JIT_SECONDS / 3600}h away`);
      break;
  }
  return errors;
}

/** Everything the quorum signs once, at setup / enrollment. */
export function standingGrants(now: number, records: RecordMeta[] = RECORDS): GrantSpec[] {
  const expiry = now + STANDING_GRANT_SECONDS;
  const grants: GrantSpec[] = [];
  for (const r of records) {
    grants.push({ kind: "recorder-write", subject: { type: "Role", id: ROLE_RECORDER }, recordId: r.id, access: "write", expiry });
    if (r.tier === 1) {
      grants.push({ kind: "tier1-standing", subject: { type: "Role", id: ROLE_CLINICIAN }, recordId: r.id, access: "read", expiry });
    }
    if (r.tier === 2 && r.breakGlassEligible) {
      grants.push({ kind: "break-glass-standing", subject: { type: "Role", id: ROLE_ER_ATTENDING }, recordId: r.id, access: "read", expiry });
    }
  }
  return grants;
}

/** What a signed policy says, as read back from its bytes. */
export interface DescribedPolicy {
  contractId: string;
  subjectType: string;
  subjectId: string;
  recordId: string;
  roles: string;
  expiry?: number;
  signed: boolean;
}

/**
 * Compare a signed policy with the grant it is supposed to be. Used before LifeKey hands a policy
 * out or reports a request AUTHORIZED: the quorum signed bytes, and those bytes must say exactly
 * what was asked for.
 */
export function policyMismatches(spec: GrantSpec, p: DescribedPolicy): string[] {
  const out: string[] = [];
  if (p.contractId !== "RelationshipAttestation:1") out.push(`contract ${p.contractId}`);
  if (!p.signed) out.push("policy is not signed");
  if (p.subjectType.toLowerCase() !== spec.subject.type.toLowerCase()) out.push(`subjectType ${p.subjectType} ≠ ${spec.subject.type}`);
  if (p.subjectId !== spec.subject.id) out.push("subjectId differs from the grant");
  if (p.recordId !== spec.recordId) out.push(`record ${p.recordId} ≠ ${spec.recordId}`);
  if (p.roles !== JSON.stringify(rolesFor(spec.access))) out.push(`roles ${p.roles}`);
  if (spec.expiry !== undefined && p.expiry !== spec.expiry) out.push(`expiry ${p.expiry} ≠ ${spec.expiry}`);
  return out;
}
