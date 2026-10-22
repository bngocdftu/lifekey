import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json } from "@/lib/auth/caller";
import { audit, nowSeconds, withStore } from "@/lib/lifekey/store.ts";

// Record who signed in and their Tide key, so a later grant can name them.
export const POST = withAuth(async (_req, jwt) => {
  const caller = callerFrom(jwt);
  await withStore((s) => {
    const seen = s.users[caller.username];
    s.users[caller.username] = { tideUserKey: caller.tideUserKey, roles: caller.realmRoles, lastSeen: nowSeconds() };
    if (!seen) audit(s, { actor: caller.username, action: "session.first-sign-in", resource: "user", outcome: "info" });
  });
  return json(caller);
});
