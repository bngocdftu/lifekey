import { withAuth } from "@/lib/auth/protect";
import { callerFrom, json } from "@/lib/auth/caller";
import { verifyAuditChain } from "@/lib/lifekey/audit.ts";
import { audit, readStore, withStore } from "@/lib/lifekey/store.ts";

export const GET = withAuth(async () => {
  const log = readStore().audit;
  return json({ entries: [...log].reverse(), brokenAt: verifyAuditChain(log), head: log.at(-1)?.hash ?? null });
});

// Decryption happens in the browser, so its outcome is reported by the client. Marked as such:
// the server cannot observe a decrypt, it can only observe who it handed a policy to.
export const POST = withAuth(async (req, jwt) => {
  const caller = callerFrom(jwt);
  const body = await req.json();
  const action = String(body.action ?? "");
  if (!/^(record\.decrypt|record\.encrypt|proof\.[a-z0-9-]+)$/.test(action)) return json({ error: "bad action" }, 400);
  await withStore((s) =>
    audit(s, {
      actor: caller.username,
      action,
      resource: String(body.resource ?? "").slice(0, 64),
      outcome: body.outcome === "ok" ? "ok" : "denied",
      detail: `client-reported: ${String(body.detail ?? "").slice(0, 300)}`,
    }),
  );
  return json({ ok: true });
});
