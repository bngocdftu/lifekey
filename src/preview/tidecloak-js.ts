// PREVIEW ONLY. Stands in for @tidecloak/js when LIFEKEY_PREVIEW=1. "Decrypting" returns the
// synthetic plaintext for the record named by the tag, so screens show realistic content.
// The preview ciphertext is "preview:<recordId>"; anything else is refused the way the network would.

import { SYNTHETIC_PLAINTEXT } from "@/lib/lifekey/catalogue";

export const IAMService = {
  _tc: {
    requestTideOperatorApproval: async (reqs: { id: string; request: Uint8Array }[]) => reqs.map((r) => ({ ...r, status: "approved" as const })),
  },
  async doDecrypt(items: { encrypted: string; tags: string[] }[], policy?: Uint8Array) {
    const allowed = policy ? new TextDecoder().decode(policy) : "";
    return items.map(({ encrypted, tags }) => {
      const rec = encrypted.replace(/^preview:/, "");
      if (rec !== tags[0]) throw new Error("Could not reach enough VVK ORKs", { cause: new Error("Tags do not contain assignmentId.") });
      if (!allowed.split(",").includes(rec)) throw new Error("Could not reach enough VVK ORKs", { cause: new Error("subjectId does not match.") });
      return JSON.stringify(SYNTHETIC_PLAINTEXT[rec]);
    });
  },
  async doEncrypt(items: { data: string; tags: string[] }[]) {
    return items.map(({ tags }) => `preview:${tags[0]}`);
  },
};
