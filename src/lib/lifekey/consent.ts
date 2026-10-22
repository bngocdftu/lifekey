// What the patient agrees to, signed from the patient's own account.
//
// ENFORCED BY THE APP, NOT THE NETWORK. The consent decides which grants LifeKey files for the
// admin quorum and which break-glass declarations it accepts; the quorum still has to sign every
// grant, and the ORKs still check every decrypt. Making the patient's own signature a condition
// the network checks needs a custom Forseti contract, which the Tide team deploys.

import { PATIENT_ACCOUNTS, RECORDS, type RecordMeta } from "./catalogue.ts";

/** What the patient may show on the emergency card (Tier 0): unencrypted, like a phone's Medical ID. */
export const TIER0_FIELDS = ["bloodType", "allergies", "medications", "implants", "emergencyContact"] as const;
export type Tier0Field = (typeof TIER0_FIELDS)[number];
export const TIER0_MAX_LENGTH = 120;

export interface ConsentInput {
  /** Tier 2 records an on-duty ER attending may open at once, reviewed afterwards. */
  breakGlass: string[];
  /** Only the fields the patient chose to show. */
  tier0: Partial<Record<Tier0Field, string>>;
}

export interface PatientConsent extends ConsentInput {
  patientId: string;
  version: number;
  signedBy: string;
  signedAt: number;
}

export function patientForAccount(username: string): string | undefined {
  return PATIENT_ACCOUNTS[username];
}

export function recordConsent(
  prev: PatientConsent | undefined,
  input: ConsentInput,
  username: string,
  now: number,
  records: RecordMeta[] = RECORDS,
): { consent: PatientConsent } | { errors: string[] } {
  const patientId = patientForAccount(username);
  if (!patientId) return { errors: ["only the patient's own account can sign their consent"] };

  const errors: string[] = [];
  const breakGlass = [...new Set((input.breakGlass ?? []).map(String))];
  for (const id of breakGlass) {
    const r = records.find((x) => x.id === id);
    if (!r || r.patientId !== patientId) errors.push(`${id} is not one of this patient's records`);
    else if (r.tier === 3) errors.push(`${id} is Tier 3: never opened by break-glass`);
    else if (r.tier !== 2) errors.push(`${id} is Tier 1: verified clinicians already see it`);
  }

  const tier0: ConsentInput["tier0"] = {};
  for (const f of TIER0_FIELDS) {
    const v = String(input.tier0?.[f] ?? "").trim().slice(0, TIER0_MAX_LENGTH);
    if (v) tier0[f] = v;
  }
  if (errors.length) return { errors };

  return { consent: { patientId, version: (prev?.version ?? 0) + 1, signedBy: username, signedAt: now, breakGlass, tier0 } };
}

/** The catalogue with break-glass eligibility taken from the patient's consent (none without one). */
export function applyConsent(records: RecordMeta[], consent: PatientConsent | undefined): RecordMeta[] {
  return records.map((r) => ({
    ...r,
    breakGlassEligible: !!consent && r.patientId === consent.patientId && r.tier === 2 && consent.breakGlass.includes(r.id),
  }));
}

export function consentChanges(prev: PatientConsent | undefined, next: PatientConsent): { added: string[]; removed: string[] } {
  const before = new Set(prev?.breakGlass ?? []);
  const after = new Set(next.breakGlass);
  return { added: [...after].filter((x) => !before.has(x)), removed: [...before].filter((x) => !after.has(x)) };
}
