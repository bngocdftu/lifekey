import { test } from "node:test";
import assert from "node:assert/strict";
import { simCannotSign, simCheckAccess, simPolicyB64, type SimSession } from "./sim-tide.ts";

const enc = (b64: string) => new TextEncoder().encode(b64);
const now = Math.floor(Date.now() / 1000);
const as = (username: string, exp = now + 600): SimSession => ({ username, sid: "t", iat: now, exp });
const reason = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return String((e as Error & { cause?: Error }).cause?.message);
  }
  return "allowed";
};
const jitForA = enc(simPolicyB64({ subjectType: "User", subjectId: "a91c5e7742d0b6f3", assignmentId: "MED-204", roles: ["_tide_decryptor"], expiry: now + 3600, signed: true }));

test("the named doctor decrypts; anyone else gets the contract's refusal", () => {
  assert.equal(reason(() => simCheckAccess("decrypt", ["MED-204"], jitForA, as("doctor-a"))), "allowed");
  assert.match(reason(() => simCheckAccess("decrypt", ["MED-204"], jitForA, as("doctor-b"))), /^subjectId does not match\./);
  assert.equal(reason(() => simCheckAccess("decrypt", ["MED-205"], jitForA, as("doctor-a"))), "Tags do not contain assignmentId.");
  assert.equal(reason(() => simCheckAccess("encrypt", ["MED-204"], jitForA, as("doctor-a"))), "_tide_encryptor not found in list of roles.");
});

test("unsigned, expired policies and expired sessions are refused", () => {
  const unsigned = enc(simPolicyB64({ subjectType: "User", subjectId: "a91c5e7742d0b6f3", assignmentId: "MED-204", roles: ["_tide_decryptor"], signed: false }));
  const expired = enc(simPolicyB64({ subjectType: "User", subjectId: "a91c5e7742d0b6f3", assignmentId: "MED-204", roles: ["_tide_decryptor"], expiry: now - 1, signed: true }));
  assert.equal(reason(() => simCheckAccess("decrypt", ["MED-204"], unsigned, as("doctor-a"))), "Policy supplied has not been signed");
  assert.equal(reason(() => simCheckAccess("decrypt", ["MED-204"], expired, as("doctor-a"))), "Policy has expired");
  assert.match(reason(() => simCheckAccess("decrypt", ["MED-204"], jitForA, as("doctor-a", now - 1))), /expired/);
});

test("role policies need the role in the token, and the operation's realm role", () => {
  const write = enc(simPolicyB64({ subjectType: "Role", subjectId: "lifekey-recorder", assignmentId: "MED-204", roles: ["_tide_encryptor"], signed: true }));
  assert.equal(reason(() => simCheckAccess("encrypt", ["MED-204"], write, as("admin"))), "allowed");
  assert.equal(reason(() => simCheckAccess("encrypt", ["MED-204"], write, as("doctor-a"))), "'lifekey-recorder' role not found in doken.");
});

test("approval quorum: approvers only, never your own request, once each", () => {
  assert.match(String(simCannotSign("doctor-a", "patient-alice", [])), /tide-realm-admin/);
  assert.match(String(simCannotSign("doctor-b", "doctor-b", [])), /own request/);
  assert.match(String(simCannotSign("doctor-b", "doctor-a", ["doctor-b"])), /already signed/);
  assert.equal(simCannotSign("doctor-c", "doctor-a", ["doctor-b"]), null);
});
