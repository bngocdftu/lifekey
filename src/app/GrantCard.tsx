"use client";

import { fmtTime } from "@/lib/client/api";
import { displayName, initials, personTint } from "./AppShell";
import { TimeLeft } from "./charts";
import { IconTile, Ring } from "./ui";

// One read grant, laid out like an appointment card: what it opens, for whom, until when, and how
// far along the signatures are.
export function GrantCard(props: {
  doctor: string;
  recordId: string;
  recordTitle?: string;
  expiresAt?: number;
  /** When the grant was asked for; with expiresAt it draws the time-left bar once authorized. */
  issuedAt?: number;
  signed: number;
  needed: number;
  signers?: string[];
  status?: string;
  verb?: string;
  person?: boolean;
}) {
  const { doctor, recordId, recordTitle, expiresAt, issuedAt, signed, needed, signers = [], status, verb = "Quyền đọc", person = true } = props;
  const left = expiresAt ? expiresAt - Math.floor(Date.now() / 1000) : undefined;
  return (
    <div className="grant">
      <div className="head" style={{ justifyContent: "space-between" }}>
        <div className="head">
          <IconTile name="key" tone="teal" round />
          <div>
            <span className="label">{verb}:</span>
            <span className="value">{recordTitle ?? recordId}</span>
          </div>
        </div>
        {status && <span className={`pill ${status === "AUTHORIZED" ? "pos" : status === "PENDING_APPROVAL" ? "warn" : "neg"}`}>{STATUS_TEXT[status] ?? status}</span>}
      </div>
      <dl className="kv">
        <div>
          <dt>Người được dùng:</dt>
          <dd style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {person && <span className="avatar" style={{ ...personTint(doctor), width: 24, height: 24, fontSize: 11 }}>{initials(doctor)}</span>}
            {displayName(doctor)}
          </dd>
        </div>
        <div><dt>Hồ sơ:</dt><dd className="mono">{recordId}</dd></div>
        <div><dt>Hết hạn:</dt><dd className="num">{expiresAt ? (left !== undefined && left > 0 ? fmtTime(expiresAt) : "Đã hết hạn") : "—"}</dd></div>
      </dl>
      {status === "AUTHORIZED" && issuedAt && expiresAt && <TimeLeft issuedAt={issuedAt} expiresAt={expiresAt} />}
      <div className="inset ring-wrap">
        <Ring value={signed} total={needed} icon="shield" />
        <div>
          <span className="label">Chữ ký duyệt</span>
          <span className="value">{signed}/{needed}</span>
          {signers.length > 0 && <span className="small muted">{signers.map(displayName).join(", ")}</span>}
        </div>
      </div>
    </div>
  );
}

export const STATUS_TEXT: Record<string, string> = {
  PENDING_APPROVAL: "Chờ duyệt",
  AUTHORIZED: "Đã duyệt",
  DENIED: "Bị từ chối",
  EXPIRED: "Hết hạn",
  REVOKED: "Đã thu hồi",
  FAILED_VALIDATION: "Không khớp",
};
