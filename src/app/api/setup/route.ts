import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json } from "@/lib/auth/caller";
import { policyName, standingGrants } from "@/lib/lifekey/grants.ts";
import { nowSeconds, readStore, withStore } from "@/lib/lifekey/store.ts";
import { fileGrant, refreshGrant } from "@/lib/lifekey/sync.ts";

// Enrollment: file every standing grant (Tier 1, recorder write-only, break-glass) for the quorum.
export const POST = withAuth(async (_req, jwt) => {
  const caller = callerFrom(jwt);
  if (!caller.isApprover) return json({ error: "a tide-realm-admin starts enrollment" }, 403);
  try {
    const filed = await withStore(async (s) => {
      const out = [];
      for (const spec of standingGrants(nowSeconds())) out.push(await fileGrant(s, policyName(spec), spec, caller.username));
      return out;
    });
    return json({ policies: filed });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

export const GET = withAuth(async () => {
  try {
    const policies = await withStore(async (s) => {
      for (const name of Object.keys(s.policies)) {
        if (s.policies[name].spec.kind !== "emergency-jit") await refreshGrant(s, name);
      }
      return Object.values(s.policies).filter((p) => p.spec.kind !== "emergency-jit");
    });
    const store = readStore();
    return json({ policies: policies.map(({ policyB64, ...p }) => ({ ...p, signed: !!policyB64 })), ciphertexts: Object.keys(store.ciphertexts) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});
