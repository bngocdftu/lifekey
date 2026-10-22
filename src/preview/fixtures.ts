// PREVIEW ONLY. Sample API answers for npm run preview: one patient, two requests, one break-glass
// event and a short audit trail, all synthetic. Held in memory for the life of the page.

import { PATIENT, RECORDS } from "@/lib/lifekey/catalogue";
import { policyName, standingGrants } from "@/lib/lifekey/grants";

const now = () => Math.floor(Date.now() / 1000);
const T0 = now();
const b64 = (s: string) => btoa(s);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const KEYS: Record<string, string> = {
  admin: "7f3a9c01e44b2d8a", "doctor-a": "a91c5e7742d0b6f3", "doctor-b": "b2d84f10c9e3a771", "doctor-c": "c0e7a2b95d14f863", "doctor-d": "d45b1e8c03a9f27e",
};

const state = {
  requests: [
    { id: "REQ-1042", patientId: PATIENT.id, recordId: "MED-204", alertId: "ALERT-88", doctorUsername: "doctor-a", doctorKey: KEYS["doctor-a"], reason: "Đánh giá nguy cơ chảy máu trước khi khâu vết thương", createdAt: T0 - 1500, expiresAt: T0 + 5700, status: "AUTHORIZED", digest: "4be1f0c27a9d3e65b8f1", policyName: "lk-emergency-jit-MED-204-user-read-REQ-1042", changeRequestId: "cr-1042" },
    { id: "REQ-1043", patientId: PATIENT.id, recordId: "MED-205", doctorUsername: "doctor-a", doctorKey: KEYS["doctor-a"], reason: "Kiểm tra loại van tim trước khi chụp cộng hưởng từ", createdAt: T0 - 420, expiresAt: T0 + 6780, status: "PENDING_APPROVAL", digest: "9c02d7e1b54fa83e6d10", policyName: "lk-emergency-jit-MED-205-user-read-REQ-1043", changeRequestId: "cr-1043" },
  ] as Record<string, any>[],
  breakGlass: [
    { id: "BG-1", patientId: PATIENT.id, recordId: "MED-204", doctorUsername: "doctor-a", doctorKey: KEYS["doctor-a"], reason: "Bệnh nhân bất tỉnh, đang chảy máu, cần biết thuốc chống đông", declaredAt: T0 - 5 * 3600, reviewDueAt: T0 + 67 * 3600, notified: ["patient", "emergency-contact", "on-call-approvers", "privacy-officer"], reviews: [{ reviewer: "doctor-c", decision: "justified", note: "Có ghi nhận chảy máu trong bệnh án lúc 03:10", at: T0 - 3600 }], status: "AWAITING_REVIEW" },
  ] as Record<string, any>[],
  signers: { "cr-1043": ["doctor-b"] } as Record<string, string[]>,
  audit: [] as Record<string, any>[],
};

const AUDIT_SEED: [number, string, string, string, string, string?][] = [
  [-26000, "admin", "grant.file", "T1-PAT-001", "ok", "Bác sĩ đã xác minh xem cảnh báo cấp cứu"],
  [-25000, "lifekey-server", "grant.signed", "T1-PAT-001", "ok", "Đủ 2 chữ ký"],
  [-24800, "admin", "record.write", "MED-204", "ok", "3.412 ký tự mã hoá"],
  [-18000, "doctor-a", "break-glass.declare", "MED-204", "ok", "Bệnh nhân bất tỉnh, đang chảy máu"],
  [-17990, "doctor-a", "record.decrypt", "MED-204", "ok", "client-reported: mở khẩn cấp"],
  [-3600, "doctor-c", "break-glass.review", "MED-204", "ok", "Hợp lý"],
  [-1500, "doctor-a", "request.create", "MED-204", "ok", "REQ-1042"],
  [-1200, "lifekey-server", "request.status", "MED-204", "ok", "REQ-1042 đã đủ 2 chữ ký"],
  [-1100, "doctor-a", "record.decrypt", "MED-204", "ok", "client-reported: theo REQ-1042"],
  [-900, "doctor-d", "record.decrypt", "MED-204", "denied", "client-reported: subjectId does not match."],
  [-420, "doctor-a", "request.create", "MED-205", "ok", "REQ-1043"],
  [-300, "lifekey-server", "proof.server-approve", "cr-1043", "denied", "Chữ ký 1 → 1"],
];
AUDIT_SEED.forEach(([dt, actor, action, resource, outcome, detail], i) =>
  state.audit.push({ seq: i + 1, at: T0 + dt, actor, action, resource, outcome, detail, prevHash: "", hash: "" }),
);

function grants() {
  return standingGrants(T0 - 26000).map((spec) => ({ name: policyName(spec), spec, changeRequestId: `cr-${spec.recordId}`, status: "SIGNED", signed: true }));
}

function caller(user: string, info: { roles: string[]; approver: boolean }) {
  return { username: user, tideUserKey: KEYS[user], realmRoles: info.roles, isApprover: info.approver };
}

export async function previewFetch(user: string, info: { roles: string[]; approver: boolean }, input: string, init: RequestInit = {}): Promise<Response> {
  await new Promise((r) => setTimeout(r, 120));
  const url = new URL(input, "http://preview.local");
  const method = (init.method ?? "GET").toUpperCase();
  const body = init.body ? JSON.parse(String(init.body)) : {};
  const p = url.pathname;

  // TideCloak's approve endpoint, called from the approver's browser.
  if (p.includes("/iga/change-requests/") && p.endsWith("/approve")) {
    const id = p.split("/").at(-2)!;
    if (!body.requestModel) return json({ mode: "needs-approval", requestModel: btoa("preview"), authCount: 0, threshold: 2 });
    const s = (state.signers[id] ??= []);
    if (!s.includes(user)) s.push(user);
    const committed = s.length >= 2;
    if (committed) state.requests.forEach((r) => { if (r.changeRequestId === id) r.status = "AUTHORIZED"; });
    return json({ mode: "recorded", committed, authCount: s.length, threshold: 2 });
  }
  if (p.includes("/iga/change-requests/") && p.endsWith("/deny")) {
    const id = p.split("/").at(-2)!;
    state.requests.forEach((r) => { if (r.changeRequestId === id) r.status = "DENIED"; });
    return json({});
  }

  if (p === "/api/session") return json(caller(user, info));

  if (p.startsWith("/api/patients/")) {
    if (p.split("/").pop() !== PATIENT.publicId) return json({ found: false, message: "No previous medical records available" }, 404);
    return json({ found: true, patient: PATIENT, records: RECORDS.map((r) => ({ ...r, ciphertext: `preview:${r.id}` })) });
  }

  if (p === "/api/policies") {
    const purpose = url.searchParams.get("purpose");
    const record = url.searchParams.get("record") ?? "";
    if (purpose === "tier1") return info.roles.includes("lifekey-clinician") ? json({ policy: b64(record) }) : json({ error: "clinicians only" }, 403);
    if (purpose === "write") return info.roles.includes("lifekey-recorder") ? json({ policy: b64(record) }) : json({ error: "records officer only" }, 403);
    if (purpose === "break-glass") return info.roles.includes("er-attending") ? json({ policy: b64(record) }) : json({ error: "er-attending only" }, 403);
    const r = state.requests.find((x) => x.id === url.searchParams.get("request"));
    if (!r || r.doctorUsername !== user) return json({ error: "this request names another doctor" }, 403);
    return r.status === "AUTHORIZED" ? json({ policy: b64(r.recordId) }) : json({ error: `request is ${r.status}` }, 409);
  }

  if (p === "/api/emergency-requests") {
    if (method === "POST") {
      const id = `REQ-${1042 + state.requests.length}`;
      const r = { id, patientId: body.patientId, recordId: body.recordId, alertId: body.alertId, doctorUsername: user, doctorKey: KEYS[user], reason: body.reason, createdAt: now(), expiresAt: now() + 7200, status: "PENDING_APPROVAL", digest: "preview", policyName: id, changeRequestId: `cr-${id}` };
      state.requests.unshift(r);
      return json({ request: r }, 201);
    }
    return json({ requests: state.requests.filter((r) => info.approver || r.doctorUsername === user) });
  }

  if (p === "/api/approvals") {
    if (!info.approver) return json({ error: "approvers only" }, 403);
    const items = state.requests.filter((r) => r.status === "PENDING_APPROVAL").map((r) => ({
      policyName: r.policyName, changeRequestId: r.changeRequestId, kind: "emergency-jit", recordId: r.recordId,
      recordTitle: RECORDS.find((x) => x.id === r.recordId)?.title, tier: 2, subject: { type: "User", username: r.doctorUsername },
      roles: ["_tide_decryptor"], expiry: r.expiresAt,
      request: { id: r.id, reason: r.reason, alertId: r.alertId, doctorUsername: r.doctorUsername, createdAt: r.createdAt, digest: r.digest },
      blockedReason: r.doctorUsername === user ? "the requesting doctor cannot approve their own request" : null,
      changeRequest: { status: "PENDING", authorizationCount: (state.signers[r.changeRequestId] ?? []).length, threshold: 2, authorizers: (state.signers[r.changeRequestId] ?? []).map((u) => ({ username: u })) },
    }));
    return json({ items, tidecloak: { url: "http://localhost:8080", realm: "lifekey" } });
  }

  if (p === "/api/break-glass") {
    if (method === "POST") {
      const e = { id: `BG-${state.breakGlass.length + 1}`, patientId: body.patientId, recordId: body.recordId, doctorUsername: user, doctorKey: KEYS[user], reason: body.reason, declaredAt: now(), reviewDueAt: now() + 72 * 3600, notified: ["patient", "emergency-contact", "on-call-approvers", "privacy-officer"], reviews: [], status: "AWAITING_REVIEW" };
      state.breakGlass.unshift(e);
      return json({ event: e }, 201);
    }
    return json({ events: state.breakGlass.map((e) => ({ ...e, overdue: now() > e.reviewDueAt })) });
  }
  if (p.startsWith("/api/break-glass/") && p.endsWith("/review")) {
    const e = state.breakGlass.find((x) => x.id === p.split("/").at(-2));
    if (!e) return json({ error: "no such event" }, 400);
    if (e.reviews.some((r: { reviewer: string }) => r.reviewer === user)) return json({ error: `${user} already reviewed this event` }, 400);
    e.reviews.push({ reviewer: user, decision: body.decision, note: body.note, at: now() });
    e.status = e.reviews.some((r: { decision: string }) => r.decision === "not_justified") ? "FLAGGED" : e.reviews.length >= 2 ? "JUSTIFIED" : "AWAITING_REVIEW";
    return json({ event: e });
  }

  if (p === "/api/audit") {
    if (method === "POST") return json({ ok: true });
    return json({ entries: [...state.audit].reverse(), brokenAt: null, head: "3f9a0c" });
  }

  if (p === "/api/setup") return json({ policies: grants(), ciphertexts: RECORDS.map((r) => r.id) });

  if (p === "/api/proof") {
    if (method === "POST") return json({ attempt: { status: 200, body: { mode: "needs-approval" } }, before: 1, after: 1, recorded: false });
    return json({
      policies: [
        ...grants().map((g) => ({ name: g.name, kind: g.spec.kind, recordId: g.spec.recordId, subject: g.spec.subject, access: g.spec.access, expiry: g.spec.expiry, policy: b64(g.spec.recordId) })),
        { name: "lk-emergency-jit-MED-204-user-read-REQ-1042", kind: "emergency-jit", recordId: "MED-204", subject: { type: "User", id: KEYS["doctor-a"] }, access: "read", policy: b64(user === "doctor-a" ? "MED-204" : "") },
      ],
      ciphertexts: Object.fromEntries(RECORDS.map((r) => [r.id, `preview:${r.id}`])),
      requests: state.requests,
      pendingChangeRequests: ["cr-1043"],
    });
  }

  return json({ error: `preview has no answer for ${method} ${p}` }, 404);
}
