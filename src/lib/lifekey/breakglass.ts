// Break-glass: one ER attending opens a pre-authorised Tier 2 record NOW, and is reviewed AFTER.
//
// The quorum is not skipped, it is moved earlier. At enrollment the patient marks which Tier 2
// records may be opened this way, and the quorum signs one standing policy per record for the role
// `er-attending`. At incident time nobody has to be found: the network checks the doctor holds the
// role, and this module makes the use visible: reason, notifications, and a mandatory review.

import { findRecord } from "./catalogue.ts";
import { ROLE_ER_ATTENDING } from "./grants.ts";

export const MIN_REASON_LENGTH = 15;
/** Reviews are due within 72 hours. */
export const REVIEW_WINDOW_SECONDS = 72 * 3600;
/** More than this many in 24h for one doctor is refused and has to go through the quorum path. */
export const MAX_PER_DOCTOR_PER_DAY = 3;
/** Distinct reviewers needed to close a break-glass event as justified. */
export const REVIEWERS_REQUIRED = 2;

export type BreakGlassStatus = "AWAITING_REVIEW" | "JUSTIFIED" | "FLAGGED";

export interface BreakGlassReview {
  reviewer: string;
  decision: "justified" | "not_justified";
  note: string;
  at: number;
}

export interface BreakGlassEvent {
  id: string;
  patientId: string;
  recordId: string;
  doctorUsername: string;
  doctorKey: string;
  reason: string;
  declaredAt: number;
  reviewDueAt: number;
  /** Who is told, at declaration time. */
  notified: string[];
  reviews: BreakGlassReview[];
  status: BreakGlassStatus;
}

export interface DeclareInput {
  id: string;
  patientId: string;
  recordId: string;
  doctorUsername: string;
  doctorKey: string;
  /** Realm roles from the doctor's VERIFIED token. The ORKs check the role again on decrypt. */
  doctorRoles: string[];
  reason: string;
}

export function declareBreakGlass(
  input: DeclareInput,
  history: BreakGlassEvent[],
  now: number,
): { event: BreakGlassEvent } | { errors: string[] } {
  const errors: string[] = [];
  const record = findRecord(input.recordId);
  if (!record) return { errors: [`unknown record ${input.recordId}`] };
  if (record.patientId !== input.patientId) errors.push(`${input.recordId} does not belong to ${input.patientId}`);
  if (record.tier === 3) errors.push("Tier 3 is never opened by break-glass");
  else if (record.tier !== 2) errors.push("break-glass is for Tier 2 records");
  if (!record.breakGlassEligible) errors.push(`the patient did not pre-authorise break-glass for ${record.id}; use a quorum request`);
  if (!input.doctorRoles.includes(ROLE_ER_ATTENDING)) errors.push(`only ${ROLE_ER_ATTENDING} may break the glass`);
  if (input.reason.trim().length < MIN_REASON_LENGTH) errors.push(`state the emergency (at least ${MIN_REASON_LENGTH} characters)`);

  const recent = history.filter((e) => e.doctorUsername === input.doctorUsername && now - e.declaredAt < 24 * 3600);
  if (recent.length >= MAX_PER_DOCTOR_PER_DAY) {
    errors.push(`${recent.length} break-glass uses in the last 24h: further access goes through the quorum`);
  }
  if (errors.length) return { errors };

  return {
    event: {
      id: input.id,
      patientId: input.patientId,
      recordId: input.recordId,
      doctorUsername: input.doctorUsername,
      doctorKey: input.doctorKey,
      reason: input.reason.trim(),
      declaredAt: now,
      reviewDueAt: now + REVIEW_WINDOW_SECONDS,
      notified: ["patient", "emergency-contact", "on-call-approvers", "privacy-officer"],
      reviews: [],
      status: "AWAITING_REVIEW",
    },
  };
}

export function reviewBreakGlass(
  event: BreakGlassEvent,
  review: Omit<BreakGlassReview, "at">,
  now: number,
): { event: BreakGlassEvent } | { error: string } {
  if (review.reviewer === event.doctorUsername) return { error: "the doctor who broke the glass cannot review it" };
  if (event.reviews.some((r) => r.reviewer === review.reviewer)) return { error: `${review.reviewer} already reviewed this event` };
  if (event.status !== "AWAITING_REVIEW") return { error: `event is already ${event.status}` };
  if (review.note.trim().length < 5) return { error: "add a review note" };

  const reviews = [...event.reviews, { ...review, note: review.note.trim(), at: now }];
  let status: BreakGlassStatus = "AWAITING_REVIEW";
  if (reviews.some((r) => r.decision === "not_justified")) status = "FLAGGED";
  else if (new Set(reviews.map((r) => r.reviewer)).size >= REVIEWERS_REQUIRED) status = "JUSTIFIED";
  return { event: { ...event, reviews, status } };
}

export function isOverdue(event: BreakGlassEvent, now: number): boolean {
  return event.status === "AWAITING_REVIEW" && now > event.reviewDueAt;
}
