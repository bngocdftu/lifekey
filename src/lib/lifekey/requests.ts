// Emergency access requests: "Doctor A wants to read MED-204 because of ALERT-88".
//
// What actually lets A decrypt is a RelationshipAttestation:1 policy naming A's key and MED-204,
// signed by the admin quorum. This module keeps LifeKey's own record of the request honest: the
// fields are fixed when the request is filed (digest), and a request only reports AUTHORIZED when
// the signed policy says exactly what was asked for.

import { createHash } from "node:crypto";
import { findRecord } from "./catalogue.ts";
import { policyMismatches, validateGrant, type DescribedPolicy, type GrantSpec } from "./grants.ts";

export type RequestStatus =
  | "PENDING_APPROVAL"
  | "AUTHORIZED"
  | "DENIED"
  | "EXPIRED"
  | "REVOKED"
  | "FAILED_VALIDATION";

/** "clinical": a doctor asks for a Tier 2 record. "patient-self": the patient asks for their own record. */
export type RequestPurpose = "clinical" | "patient-self";

export interface Clarification {
  by: string;
  text: string;
  at: number;
}

export interface EmergencyRequest {
  id: string;
  /** Absent on requests filed before patients could ask; those are clinical. */
  purpose?: RequestPurpose;
  patientId: string;
  recordId: string;
  alertId?: string;
  /** The doctor who will read. Approvers must be other people. */
  doctorUsername: string;
  /** That doctor's tideuserkey: what the policy names, and what the ORKs check. */
  doctorKey: string;
  reason: string;
  /** Epoch seconds. */
  createdAt: number;
  expiresAt: number;
  status: RequestStatus;
  statusReason?: string;
  /** sha256 over the binding fields, fixed at filing. */
  digest: string;
  policyName: string;
  changeRequestId?: string;
  /** Questions from approvers. Not bound into the digest: asking does not change what is granted. */
  clarifications?: Clarification[];
}

export interface NewRequestInput {
  patientId: string;
  recordId: string;
  alertId?: string;
  doctorUsername: string;
  doctorKey: string;
  reason: string;
  ttlSeconds: number;
  purpose?: RequestPurpose;
}

/** The fields a request is bound to. Changing any of them after filing breaks the digest. */
function bindingFields(r: Pick<EmergencyRequest, "id" | "purpose" | "patientId" | "recordId" | "alertId" | "doctorUsername" | "doctorKey" | "reason" | "createdAt" | "expiresAt">) {
  return {
    // Only bound when set, so digests of requests filed before `purpose` existed stay valid.
    ...(r.purpose && r.purpose !== "clinical" ? { purpose: r.purpose } : {}),
    id: r.id,
    patientId: r.patientId,
    recordId: r.recordId,
    alertId: r.alertId ?? null,
    doctorUsername: r.doctorUsername,
    doctorKey: r.doctorKey,
    permission: "read",
    reason: r.reason,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  };
}

export function requestDigest(r: Parameters<typeof bindingFields>[0]): string {
  return createHash("sha256").update(JSON.stringify(bindingFields(r))).digest("hex");
}

export function requestGrant(r: Pick<EmergencyRequest, "doctorKey" | "recordId" | "expiresAt" | "purpose">): GrantSpec {
  return { kind: r.purpose === "patient-self" ? "patient-self" : "emergency-jit", subject: { type: "User", id: r.doctorKey }, recordId: r.recordId, access: "read", expiry: r.expiresAt };
}

export function createEmergencyRequest(
  input: NewRequestInput,
  now: number,
  id: string,
  policyNameFor: (spec: GrantSpec, requestId: string) => string,
): { request: EmergencyRequest } | { errors: string[] } {
  const errors: string[] = [];
  const record = findRecord(input.recordId);
  if (!record) return { errors: [`unknown record ${input.recordId}`] };
  if (record.patientId !== input.patientId) errors.push(`${input.recordId} does not belong to ${input.patientId}`);
  if (!input.doctorUsername) errors.push("doctor is required");
  if (!input.doctorKey) errors.push("doctor has no tideuserkey: they must sign in with Tide first");
  if (input.reason.trim().length < 10) errors.push("give a reason (at least 10 characters)");

  const purpose = input.purpose ?? "clinical";
  const expiresAt = now + Math.floor(input.ttlSeconds);
  const spec = requestGrant({ doctorKey: input.doctorKey, recordId: input.recordId, expiresAt, purpose });
  errors.push(...validateGrant(spec, now));
  if (errors.length) return { errors };

  const base = {
    id,
    ...(purpose === "patient-self" ? { purpose } : {}),
    patientId: input.patientId,
    recordId: input.recordId,
    alertId: input.alertId,
    doctorUsername: input.doctorUsername,
    doctorKey: input.doctorKey,
    reason: input.reason.trim(),
    createdAt: now,
    expiresAt,
  };
  return {
    request: { ...base, status: "PENDING_APPROVAL", digest: requestDigest(base), policyName: policyNameFor(spec, id) },
  };
}

/** Status as of `now`: an authorized request lapses by itself. */
export function effectiveStatus(r: EmergencyRequest, now: number): RequestStatus {
  if ((r.status === "AUTHORIZED" || r.status === "PENDING_APPROVAL") && now >= r.expiresAt) return "EXPIRED";
  return r.status;
}

/**
 * Move a pending request to AUTHORIZED once its policy is signed, or to FAILED_VALIDATION when the
 * stored request was altered or the signed policy says something else.
 */
export function applySignedPolicy(r: EmergencyRequest, policy: DescribedPolicy, now: number): EmergencyRequest {
  if (r.status !== "PENDING_APPROVAL") return r;
  if (requestDigest(r) !== r.digest) {
    return { ...r, status: "FAILED_VALIDATION", statusReason: "request fields changed after filing" };
  }
  const mismatches = policyMismatches(requestGrant(r), policy);
  if (mismatches.length) {
    return { ...r, status: "FAILED_VALIDATION", statusReason: `signed policy does not match: ${mismatches.join("; ")}` };
  }
  if (now >= r.expiresAt) return { ...r, status: "EXPIRED" };
  return { ...r, status: "AUTHORIZED" };
}

/** An approver asks the requester for more detail before signing. */
export function askClarification(r: EmergencyRequest, approver: string, text: string, now: number): { request: EmergencyRequest } | { error: string } {
  if (approver === r.doctorUsername) return { error: "you cannot question your own request" };
  if (r.status !== "PENDING_APPROVAL") return { error: `request is ${r.status}` };
  const t = text.trim();
  if (t.length < 5) return { error: "write the question (at least 5 characters)" };
  return { request: { ...r, clarifications: [...(r.clarifications ?? []), { by: approver, text: t.slice(0, 500), at: now }] } };
}

/** App-level guard on top of the realm rule that the requester is not an approver. */
export function canApprove(r: EmergencyRequest, approverUsername: string): string | null {
  if (approverUsername === r.doctorUsername) return "the requesting doctor cannot approve their own request";
  if (r.status !== "PENDING_APPROVAL") return `request is ${r.status}`;
  return null;
}
