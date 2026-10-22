// Append-only audit log, hash-chained so an edited or deleted entry is detectable.
//
// This is LifeKey's own log, kept by the app server. It shows who asked for what and what the
// network answered. It never contains plaintext. It is tamper-EVIDENT, not tamper-proof: whoever
// controls the server can rewrite the whole chain, so export the head hash somewhere else.

import { createHash } from "node:crypto";

export interface AuditEntry {
  seq: number;
  at: number;
  actor: string;
  action: string;
  resource: string;
  outcome: "ok" | "denied" | "error" | "info";
  detail?: string;
  prevHash: string;
  hash: string;
}

export const GENESIS = "0".repeat(64);

function entryHash(e: Omit<AuditEntry, "hash">): string {
  const { seq, at, actor, action, resource, outcome, detail, prevHash } = e;
  return createHash("sha256")
    .update(JSON.stringify({ seq, at, actor, action, resource, outcome, detail: detail ?? null, prevHash }))
    .digest("hex");
}

export function appendAudit(
  log: AuditEntry[],
  e: Pick<AuditEntry, "actor" | "action" | "resource" | "outcome" | "detail">,
  now: number,
): AuditEntry {
  const prev = log[log.length - 1];
  const base = { ...e, seq: prev ? prev.seq + 1 : 1, at: now, prevHash: prev ? prev.hash : GENESIS };
  const entry = { ...base, hash: entryHash(base) };
  log.push(entry);
  return entry;
}

/** null when the chain holds, otherwise the seq of the first entry that does not verify. */
export function verifyAuditChain(log: AuditEntry[]): number | null {
  let prevHash = GENESIS;
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.seq !== i + 1 || e.prevHash !== prevHash || entryHash(e) !== e.hash) return e.seq;
    prevHash = e.hash;
  }
  return null;
}
