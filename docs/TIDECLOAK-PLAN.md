# Where TideCloak fits in LifeKey

This plan comes from Tide's MCP server (`https://mcp.tide.org/mcp`): `tide_blast_radius` for an
existing app, and the scenarios `relationship-attestation` and `iga-admin-governance`. On submission
day the Tide network failed to create accounts and wallets (see the README), so `npm run preview`
**simulates** each piece below in the browser (`src/preview/sim-tide.ts`). The simulation follows
the same rules, but it is not secure. Everything runs client-side.

| Concern | Real TideCloak | Simulated in preview |
|---|---|---|
| Sign-in | Tide account, key held in the Tide enclave; `@tidecloak/nextjs` provider | Tide-style sign-in dialog, session in localStorage, 10-minute token refreshed on each call, 401 when expired |
| Identity in the token | `preferred_username`, `tideuserkey`, `realm_access.roles`, `resource_access.realm-management.roles` | Same claim names and shapes (`simClaims`) |
| Realm roles | `lifekey-clinician`, `er-attending`, `lifekey-recorder`, `lifekey-patient`, `_tide_decryptor`, `_tide_encryptor` | Same, per demo account |
| Approvers | Client role `tide-realm-admin` on `realm-management` (admin, doctor-b, doctor-c) | Same |
| Per-record access | `RelationshipAttestation:1` policy: subject (User key or Role), `assignmentId` = record id, `roles`, expiry; checked by the ORKs on every encrypt or decrypt | `simCheckAccess` runs the same checks and throws the contract's messages, wrapped in the usual "Could not reach enough VVK ORKs" error |
| Granting access | Change request; 2 of 3 approvers sign in their own enclave; the policy exists only at quorum | Approve endpoint refuses non-approvers, self-approval and double votes; enclave dialog in the page; `AUTHORIZED` at 2 signatures |
| Server | Never holds a user key, cannot approve; `/api/proof` S1 shows a server call stays at "needs-approval" | Same answer |

## What is enforced where

- **Network (ORKs):** who may decrypt or encrypt which record, until when. This is the only real protection for record contents.
- **TideCloak realm:** who may approve (quorum, no self-approval), the token's roles.
- **LifeKey app only:** reasons, break-glass notices and the 72-hour review, patient consent screens, the audit log. A7 on the Proof page shows this limit: the network allows a break-glass read that the app was never told about.

## Going live

1. `scripts/init-tidecloak.sh` with a licence email (free tier: at most 5 users).
2. Link admin, doctor-a, doctor-b and patient-alice, then doctor-c, before the realm switches to multi-admin.
3. Give doctor-b and doctor-c `tide-realm-admin` (docs/RUNBOOK.md step 3); raise the threshold to 2.
4. `npm run dev` instead of `npm run preview`. The app code is the same; only the two SDK aliases in `next.config.ts` change.
