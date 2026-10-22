// Server-side store: a JSON file in data/. Enough for a hackathon demo on one machine; swap for
// Postgres/Supabase later. Holds ciphertext, signed policies, requests and audit. Never plaintext.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendAudit, type AuditEntry } from "./audit.ts";
import type { BreakGlassEvent } from "./breakglass.ts";
import type { GrantSpec } from "./grants.ts";
import type { EmergencyRequest } from "./requests.ts";

export interface StoredCiphertext {
  recordId: string;
  ciphertext: string;
  writtenBy: string;
  at: number;
}

export interface StoredPolicy {
  name: string;
  spec: GrantSpec;
  /** Set once filed with TideCloak. */
  changeRequestId?: string;
  /** Base64 of the SIGNED policy, once the quorum has approved. */
  policyB64?: string;
  status: "PENDING_QUORUM" | "SIGNED" | "FAILED";
  statusReason?: string;
}

export interface StoreShape {
  ciphertexts: Record<string, StoredCiphertext>;
  policies: Record<string, StoredPolicy>;
  requests: Record<string, EmergencyRequest>;
  breakGlass: Record<string, BreakGlassEvent>;
  /** username -> tideuserkey, recorded at sign-in so a grant can name the user later. */
  users: Record<string, { tideUserKey: string; roles: string[]; lastSeen: number }>;
  audit: AuditEntry[];
  counters: { request: number; breakGlass: number };
}

const FILE = join(process.cwd(), "data", "lifekey-store.json");

function empty(): StoreShape {
  return { ciphertexts: {}, policies: {}, requests: {}, breakGlass: {}, users: {}, audit: [], counters: { request: 1041, breakGlass: 0 } };
}

function load(): StoreShape {
  if (!existsSync(FILE)) return empty();
  return { ...empty(), ...JSON.parse(readFileSync(FILE, "utf-8")) };
}

function save(s: StoreShape) {
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, FILE);
}

// One writer at a time inside this process. Route handlers await each other through this chain.
let chain: Promise<unknown> = Promise.resolve();

export function withStore<T>(fn: (s: StoreShape) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const s = load();
    const out = await fn(s);
    save(s);
    return out;
  });
  chain = run.catch(() => undefined);
  return run;
}

export function readStore(): StoreShape {
  return load();
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function audit(s: StoreShape, e: Parameters<typeof appendAudit>[1]) {
  return appendAudit(s.audit, e, nowSeconds());
}
