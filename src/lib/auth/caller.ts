import type { JWTPayload } from "jose";
import { hasRole } from "./tideJWT";

export interface Caller {
  username: string;
  /** The caller's Tide public key, exactly as their credential carries it. What a User policy names. */
  tideUserKey: string;
  realmRoles: string[];
  /** Holds tide-realm-admin: one vote in the admin quorum. */
  isApprover: boolean;
}

// Every value here comes from a token whose signature and DPoP binding withAuth already verified.
export function callerFrom(jwt: JWTPayload): Caller {
  const realmRoles = ((jwt.realm_access as { roles?: string[] } | undefined)?.roles ?? []).map(String);
  return {
    username: String(jwt.preferred_username ?? jwt.sub ?? ""),
    tideUserKey: typeof jwt.tideuserkey === "string" ? jwt.tideuserkey : "",
    realmRoles,
    isApprover: hasRole(jwt, "tide-realm-admin"),
  };
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}
