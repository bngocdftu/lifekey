// Build and read RelationshipAttestation:1 policy bytes with the Tide SDK.
//
// Server only (uses Buffer; Next.js bundles @tideorg/js with webpack). Building the UNSIGNED bytes
// grants nothing: only the admin quorum's signature does.

import { Models } from "@tideorg/js";
import { policyParams, type DescribedPolicy, type GrantSpec } from "@/lib/lifekey/grants.ts";

export const RELATIONSHIP_CONTRACT_ID = "RelationshipAttestation:1";
export const RELATIONSHIP_MODEL_IDS = ["PolicyEnabledEncryption:1", "PolicyEnabledDecryption:1"];

const toBase64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const fromBase64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

export function buildUnsignedPolicyB64(spec: GrantSpec, vendorId: string): string {
  // The SDK only writes its own latest policy version. Never hard-code it.
  const version = (Models.Policy as unknown as { latestVersion: string }).latestVersion;
  const policy = new Models.Policy({
    version,
    contractId: RELATIONSHIP_CONTRACT_ID,
    modelId: RELATIONSHIP_MODEL_IDS,
    keyId: vendorId,
    approvalType: Models.ApprovalType.IMPLICIT,
    executionType: Models.ExecutionType.PRIVATE,
    params: new Map<string, string>(policyParams(spec)),
    ...(spec.expiry ? { expiry: spec.expiry } : {}),
  } as ConstructorParameters<typeof Models.Policy>[0]);
  return toBase64(policy.toBytes());
}

export function describePolicyB64(policyB64: string): DescribedPolicy {
  const p = Models.Policy.from(fromBase64(policyB64)) as unknown as {
    contractId: string;
    expiry?: bigint | number;
    signature?: Uint8Array;
    params: { entries: Map<string, unknown> };
  };
  const param = (k: string) => String(p.params.entries.get(k) ?? "");
  return {
    contractId: p.contractId,
    subjectType: param("subjectType"),
    subjectId: param("subjectId"),
    recordId: param("assignmentId"),
    roles: param("roles"),
    expiry: p.expiry === undefined || p.expiry === null ? undefined : Number(p.expiry),
    signed: !!p.signature && p.signature.length > 0,
  };
}
