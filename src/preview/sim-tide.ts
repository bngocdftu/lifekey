// PREVIEW ONLY: a simulation of the parts of TideCloak LifeKey relies on, so the app behaves as if
// TideCloak protected it while the real Tide network is unavailable. Nothing here is secure: it all
// runs in the browser. What it reproduces, rule for rule, is what the real system enforces
// (Tide agent pack, scenarios relationship-attestation and iga-admin-governance):
//
//   sign-in        a Tide account per person; the "token" carries preferred_username, tideuserkey,
//                  realm roles and the realm-management client role tide-realm-admin, and expires
//   decrypt/write  RelationshipAttestation:1 — the caller must match the policy's subject, the item's
//                  only tag must be the record id, the policy's `roles` must permit the operation, the
//                  caller must hold the same realm role, and the policy must be signed and unexpired
//   approvals      only tide-realm-admin holders sign, the requester never signs their own request,
//                  and a policy exists only once the threshold is met

export const SIM_REALM_URL = "http://localhost:8080/realms/lifekey";
const SESSION_KEY = "lk-sim-tide-session-v1";
const TOKEN_SECONDS = 600; // the realm's access-token lifespan (scripts/realm.json.template)

export const ROLE_DECRYPT = "_tide_decryptor";
export const ROLE_ENCRYPT = "_tide_encryptor";
export const ROLE_REALM_ADMIN = "tide-realm-admin";

export interface SimAccount {
  username: string;
  tideUsername: string;
  /** What a User policy names, as the tideuserkey claim carries it. */
  tideUserKey: string;
  realmRoles: string[];
  /** Holds tide-realm-admin on realm-management: one vote in the approval quorum. */
  approver: boolean;
  about: string;
}

export const SIM_ACCOUNTS: SimAccount[] = [
  { username: "admin", tideUsername: "lifekey-records", tideUserKey: "7f3a9c01e44b2d8a", realmRoles: ["lifekey-recorder", ROLE_ENCRYPT], approver: true, about: "Records office. Writes records, cannot read them. Approver." },
  { username: "doctor-a", tideUsername: "lifekey-doctor-a", tideUserKey: "a91c5e7742d0b6f3", realmRoles: ["lifekey-clinician", "er-attending", ROLE_DECRYPT], approver: false, about: "ER doctor on duty. Requests records, can break the glass." },
  { username: "doctor-b", tideUsername: "lifekey-doctor-b", tideUserKey: "b2d84f10c9e3a771", realmRoles: [ROLE_DECRYPT], approver: true, about: "Clinical approver." },
  { username: "doctor-c", tideUsername: "lifekey-doctor-c", tideUserKey: "c0e7a2b95d14f863", realmRoles: [ROLE_DECRYPT], approver: true, about: "Access approver." },
  { username: "patient-alice", tideUsername: "alice-nguyen", tideUserKey: "e81f3a6c27d09b45", realmRoles: ["lifekey-patient", ROLE_DECRYPT], approver: false, about: "The patient. Signs consent, sees who opened her records." },
];

export function simAccount(username: string | null | undefined): SimAccount | undefined {
  return SIM_ACCOUNTS.find((a) => a.username === username);
}

// ---------- session ----------

export interface SimSession {
  username: string;
  sid: string;
  iat: number;
  exp: number;
}

const nowS = () => Math.floor(Date.now() / 1000);

export function simReadSession(): SimSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SimSession;
    return simAccount(s.username) ? s : null;
  } catch {
    return null;
  }
}

export function simSessionValid(s: SimSession | null): s is SimSession {
  return !!s && s.exp > nowS();
}

/** Sign in as a demo account. The password is only checked for presence: this is a simulation. */
export function simSignIn(username: string, password: string): SimSession {
  const account = simAccount(username);
  if (!account) throw new Error("No Tide account with that username");
  if (!password) throw new Error("Enter your Tide password");
  const s: SimSession = { username, sid: Math.random().toString(36).slice(2, 10), iat: nowS(), exp: nowS() + TOKEN_SECONDS };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: the session lasts for this page only */
  }
  return s;
}

export function simRefresh(s: SimSession): SimSession {
  const next = { ...s, exp: nowS() + TOKEN_SECONDS };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function simSignOut() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** The access token's claims, shaped as TideCloak issues them. */
export function simClaims(s: SimSession) {
  const a = simAccount(s.username)!;
  return {
    iss: SIM_REALM_URL,
    azp: "lifekey-client",
    sub: a.tideUserKey,
    sid: s.sid,
    iat: s.iat,
    exp: s.exp,
    preferred_username: a.username,
    tideuserkey: a.tideUserKey,
    realm_access: { roles: ["_tide_enabled", "appUser", ...a.realmRoles] },
    resource_access: a.approver ? { "realm-management": { roles: [ROLE_REALM_ADMIN, "manage-realm"] } } : {},
  };
}

// ---------- RelationshipAttestation:1 policies ----------

export interface SimPolicy {
  contractId: "RelationshipAttestation:1";
  subjectType: "User" | "Role";
  subjectId: string;
  assignmentId: string;
  roles: string[];
  expiry?: number;
  /** Set only once the approval threshold was met. */
  signed: boolean;
}

export function simPolicyB64(p: Omit<SimPolicy, "contractId">): string {
  return btoa(JSON.stringify({ contractId: "RelationshipAttestation:1", ...p }));
}

function decodePolicy(bytes?: Uint8Array): SimPolicy | null {
  if (!bytes || !bytes.length) return null;
  try {
    return JSON.parse(atob(new TextDecoder().decode(bytes))) as SimPolicy;
  } catch {
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as SimPolicy;
    } catch {
      return null;
    }
  }
}

/** The ORKs' answer to a refused request: the wrapper message, with the contract's reason as cause. */
function refused(reason: string): Error {
  return new Error("Could not reach enough VVK ORKs (simulated: every ORK refused)", { cause: new Error(reason) });
}

/**
 * Check one encrypt or decrypt the way RelationshipAttestation:1 does, for the signed-in caller.
 * Returns nothing when allowed; throws the contract's own refusal otherwise.
 */
export function simCheckAccess(op: "encrypt" | "decrypt", tags: string[], policyBytes: Uint8Array | undefined, session: SimSession | null) {
  if (!simSessionValid(session)) throw refused("Doken expired: sign in again.");
  const caller = simAccount(session.username)!;
  const p = decodePolicy(policyBytes);
  if (!p || p.contractId !== "RelationshipAttestation:1") throw refused("Model does not have a policy passed with it");
  if (!p.signed) throw refused("Policy supplied has not been signed");
  if (p.expiry && p.expiry <= nowS()) throw refused("Policy has expired");
  if (!tags.length) throw refused("Every item must be tagged with the assignmentId.");
  if (tags.length !== 1 || tags[0] !== p.assignmentId) throw refused("Tags do not contain assignmentId.");
  if (p.subjectType === "User" && p.subjectId !== caller.tideUserKey) {
    throw refused(`subjectId does not match. ${caller.tideUserKey} <> ${p.subjectId}`);
  }
  if (p.subjectType === "Role" && !caller.realmRoles.includes(p.subjectId)) {
    throw refused(`'${p.subjectId}' role not found in doken.`);
  }
  const role = op === "decrypt" ? ROLE_DECRYPT : ROLE_ENCRYPT;
  if (!p.roles.includes(role)) throw refused(`${role} not found in list of roles.`);
  if (!caller.realmRoles.includes(role)) throw refused(`'${role}' role not found for this ${op}ion request.`);
}

// ---------- the approval quorum ----------

export const SIM_THRESHOLD = 2;

/** Why this person may not sign this change request, or null when they may. */
export function simCannotSign(username: string, requester: string | undefined, signers: string[]): string | null {
  const a = simAccount(username);
  if (!a?.approver) return "Only tide-realm-admin holders can approve (403).";
  if (requester && requester === username) return "The requester cannot approve their own request.";
  if (signers.includes(username)) return "You have already signed this request.";
  return null;
}
