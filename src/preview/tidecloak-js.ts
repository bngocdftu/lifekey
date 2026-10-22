// PREVIEW ONLY. Stands in for @tidecloak/js when LIFEKEY_PREVIEW=1. Encrypt and decrypt go through
// the simulated RelationshipAttestation:1 check (sim-tide.ts) for the signed-in account, so a
// doctor without a signed policy is refused with the contract's own message, as on the network.
// The preview ciphertext is "preview:<recordId>"; decrypting returns the synthetic plaintext.

import { SYNTHETIC_PLAINTEXT } from "@/lib/lifekey/catalogue";
import { simCheckAccess, simClaims, simReadSession, simSessionValid } from "./sim-tide";
import { simEnclaveApprove } from "./sim-enclave";

export const IAMService = {
  _tc: {
    // The doken: the token the ORKs check, with the caller's tideuserkey and realm roles.
    get dokenParsed() {
      const s = simReadSession();
      return simSessionValid(s) ? simClaims(s) : undefined;
    },
    // The Tide enclave pop-up: here an in-page dialog where the approver reviews and signs.
    requestTideOperatorApproval: async (reqs: { id: string; request: Uint8Array }[]) => {
      const ok = await simEnclaveApprove(reqs.map((r) => r.id));
      return reqs.map((r) => ({ ...r, status: ok ? ("approved" as const) : ("denied" as const) }));
    },
  },
  async doDecrypt(items: { encrypted: string; tags: string[] }[], policy?: Uint8Array) {
    const session = simReadSession();
    return items.map(({ encrypted, tags }) => {
      simCheckAccess("decrypt", tags, policy, session);
      const rec = encrypted.replace(/^preview:/, "");
      if (rec !== tags[0]) throw new Error("Could not reach enough VVK ORKs", { cause: new Error("Tags do not contain assignmentId.") });
      return JSON.stringify(SYNTHETIC_PLAINTEXT[rec]);
    });
  },
  async doEncrypt(items: { data: string; tags: string[] }[], policy?: Uint8Array) {
    const session = simReadSession();
    return items.map(({ tags }) => {
      simCheckAccess("encrypt", tags, policy, session);
      return `preview:${tags[0]}`;
    });
  },
};
