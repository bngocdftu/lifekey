import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json } from "@/lib/auth/caller";
import { audit, readStore, withStore } from "@/lib/lifekey/store.ts";
import { getChangeRequest, tryServerSideApprove } from "@/lib/tide/igaServer";

// PROOF ONLY. Hands every signed policy to any signed-in user, on purpose: the claim under test is
// that a policy is not a secret, because the network only honours it for the subject it names.
// A production LifeKey would not expose this.
export const GET = withAuth(async () => {
  const s = readStore();
  return json({
    policies: Object.values(s.policies)
      .filter((p) => p.status === "SIGNED")
      .map((p) => ({ name: p.name, kind: p.spec.kind, recordId: p.spec.recordId, subject: p.spec.subject, access: p.spec.access, expiry: p.spec.expiry, policy: p.policyB64 })),
    ciphertexts: Object.fromEntries(Object.entries(s.ciphertexts).map(([k, v]) => [k, v.ciphertext])),
    requests: Object.values(s.requests),
    pendingChangeRequests: Object.values(s.policies).filter((p) => p.status === "PENDING_QUORUM").map((p) => p.changeRequestId),
  });
});

// The server holds master-admin credentials. Show that they cannot stand in for an approver.
export const POST = withAuth(async (req, jwt) => {
  const caller = callerFrom(jwt);
  const { changeRequestId } = await req.json();
  if (typeof changeRequestId !== "string") return json({ error: "changeRequestId required" }, 400);
  const before = await fetchCount(changeRequestId);
  const attempt = await tryServerSideApprove(changeRequestId);
  const after = await fetchCount(changeRequestId);
  const recorded = after !== null && before !== null && after > before;
  await withStore((s) =>
    audit(s, { actor: caller.username, action: "proof.server-approve", resource: changeRequestId, outcome: recorded ? "error" : "denied", detail: `HTTP ${attempt.status}; approvals ${before} → ${after}` }),
  );
  return json({ attempt, before, after, recorded });
});

async function fetchCount(id: string): Promise<number | null> {
  const cr = await getChangeRequest(id).catch(() => null);
  return cr?.authorizationCount ?? (cr?.authorizers?.length ?? null);
}
