// The synthetic patient and records the demo runs on. SYNTHETIC DATA ONLY: never real patients.
//
// Each record is encrypted on its own, under its own id. That id is the ONLY tag the network
// accepts for it (RelationshipAttestation:1), so "which record" is enforced by the ORKs, not here.

export type Tier = 1 | 2 | 3;

export interface Patient {
  id: string;
  /** What the QR carries. Opaque: no medical data, no key. */
  publicId: string;
  displayName: string;
}

export interface RecordMeta {
  id: string;
  patientId: string;
  tier: Tier;
  title: string;
  category: string;
  /**
   * Break-glass may open this record. The values below are only the suggested defaults the consent
   * form starts from; what counts is the patient's signed consent (consent.ts, applyConsent).
   * Only Tier 2 may be eligible: Tier 3 always needs its own legal basis.
   */
  breakGlassEligible: boolean;
}

export interface SafetyAlert {
  id: string;
  sourceRecordId: string;
  category: "allergy" | "high_risk_medication" | "implant" | "condition" | "restricted_record";
  /** Concrete and actionable. Generalised only when the source is Tier 3 and the patient chose it. */
  message: string;
  contextTags: string[];
  verificationStatus: "clinician_verified" | "patient_reported" | "unverified";
  verifiedAt?: string;
  verifiedBy?: string;
}

export const PATIENT: Patient = {
  id: "PAT-001",
  publicId: "p_8f29a1",
  displayName: "Alice Nguyen (synthetic)",
};

export const RECORDS: RecordMeta[] = [
  { id: "T1-PAT-001", patientId: "PAT-001", tier: 1, title: "Emergency summary", category: "summary", breakGlassEligible: false },
  { id: "MED-204", patientId: "PAT-001", tier: 2, title: "Full medication list", category: "medications", breakGlassEligible: true },
  { id: "MED-205", patientId: "PAT-001", tier: 2, title: "Surgical history", category: "surgical_history", breakGlassEligible: false },
  { id: "PSY-301", patientId: "PAT-001", tier: 3, title: "Mental health record", category: "mental_health", breakGlassEligible: false },
];

/** Which patient each patient account is. The account signs that patient's consent and sees their log. */
export const PATIENT_ACCOUNTS: Record<string, string> = { "patient-alice": "PAT-001" };

export function findRecord(recordId: string): RecordMeta | undefined {
  return RECORDS.find((r) => r.id === recordId);
}

export function tier1RecordId(patientId: string): string {
  return `T1-${patientId}`;
}

/** Tier 1 alerts, concrete enough to act on without opening Tier 2. */
export const TIER1_ALERTS: SafetyAlert[] = [
  {
    id: "ALERT-88",
    sourceRecordId: "MED-204",
    category: "high_risk_medication",
    message: "Takes warfarin 5 mg/day (anticoagulant). Bleeding risk: check INR before any procedure.",
    contextTags: ["trauma", "surgery", "bleeding"],
    verificationStatus: "clinician_verified",
    verifiedAt: "2026-10-20T10:00:00Z",
    verifiedBy: "DOC-REVIEWER-01",
  },
  {
    id: "ALERT-87",
    sourceRecordId: "MED-204",
    category: "allergy",
    message: "Penicillin allergy: anaphylaxis (2019). Avoid beta-lactam antibiotics.",
    contextTags: ["all"],
    verificationStatus: "clinician_verified",
    verifiedAt: "2026-10-20T10:00:00Z",
    verifiedBy: "DOC-REVIEWER-01",
  },
  {
    id: "ALERT-89",
    sourceRecordId: "MED-205",
    category: "implant",
    message: "Mechanical heart valve (2021). No MRI until the valve type is confirmed.",
    contextTags: ["imaging", "all"],
    verificationStatus: "clinician_verified",
    verifiedAt: "2026-10-20T10:00:00Z",
    verifiedBy: "DOC-REVIEWER-01",
  },
  {
    // Generalised on purpose: the source is Tier 3 and the patient chose not to name it.
    id: "ALERT-90",
    sourceRecordId: "PSY-301",
    category: "restricted_record",
    message: "A restricted record concerns sedative drug interactions. Review before giving a benzodiazepine.",
    contextTags: ["sedation"],
    verificationStatus: "clinician_verified",
    verifiedAt: "2026-10-20T10:00:00Z",
    verifiedBy: "DOC-REVIEWER-01",
  },
];

/**
 * Plaintext the records officer encrypts during seeding, in their own browser. It never reaches
 * the server: the server only ever stores what comes back from the network as ciphertext.
 */
export const SYNTHETIC_PLAINTEXT: Record<string, unknown> = {
  "T1-PAT-001": {
    patient: "Alice Nguyen (synthetic)",
    bloodType: "O+",
    alerts: TIER1_ALERTS,
    dataStatus: {
      allergies: "clinician_verified",
      medications: "clinician_verified",
      implants: "clinician_verified",
      pregnancy: "no_data",
    },
    emergencyContact: "Bob Nguyen (synthetic), 0900 000 000",
  },
  "MED-204": {
    medications: [
      { name: "Warfarin", dose: "5 mg", frequency: "once daily", since: "2021-06", indication: "Mechanical heart valve", lastINR: { value: 2.8, at: "2026-10-12" } },
      { name: "Metoprolol", dose: "25 mg", frequency: "twice daily", since: "2021-06" },
      { name: "Atorvastatin", dose: "20 mg", frequency: "once daily", since: "2023-02" },
    ],
    allergies: [{ substance: "Penicillin", reaction: "Anaphylaxis", year: 2019 }],
    source: "Synthetic EHR export, FHIR MedicationStatement-like",
  },
  "MED-205": {
    procedures: [
      { name: "Mitral valve replacement (mechanical valve)", year: 2021, hospital: "Synthetic General Hospital" },
      { name: "Appendectomy", year: 2009 },
    ],
  },
  "PSY-301": {
    note: "Synthetic Tier 3 record. Used only to show that a Tier 2 grant cannot open Tier 3.",
  },
};
