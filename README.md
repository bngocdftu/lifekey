# LifeKey

**Emergency doctors see the alerts that keep a patient alive at once; the full record opens only for one named doctor, one record and a short time, approved by two people and enforced by the Tide network, not our server.**

<!-- Project overview: 300 words or fewer. Replace the headings below with the organisers' template if they differ. -->

**The possibility.** An unconscious patient arrives at 3 a.m. The ER doctor needs to know about warfarin, a penicillin allergy and a mechanical heart valve now, and sometimes the full medication list, without anyone browsing every record "just in case".

**The constraint.** Today whoever runs the server or holds an admin account can read or grant access to everything. One compromised server or one insider exposes every patient, and "break-the-glass" is a checkbox an admin can bypass.

**The prototype and TideCloak's role.** Every record is encrypted on its own. A read grant is a TideCloak policy (`RelationshipAttestation:1`) naming one doctor's Tide key, one record and an expiry; it exists only once two approvers sign it through TideCloak's quorum, and the Tide network checks doctor, record, operation and expiry on every decryption. Emergency summaries are pre-approved for verified clinicians; break-glass opens only records the patient pre-authorised, for on-duty ER doctors, with review afterwards.

**Why ordinary login is not enough.** With normal login our server would hold the keys and decide who reads what. Here it stores only ciphertext and cannot sign a grant: a leaked grant fails for anyone else (even the approver who signed it), a MED-204 grant cannot open MED-205, and the server cannot approve for anyone.

**What changes.** Patients let emergency teams see what matters without exposing everything, and hospitals can show that no single admin, server or AI can open a record alone.

Synthetic data only. Demo video: [`docs/demo.mp4`](docs/demo.mp4), recorded in preview mode because the Tide network was failing on submission day (see below).

---

## Status on submission day (22 Oct 2026)

**What ran for real.** TideCloak `0.14.41` (`tideorg/tidecloak-dev`) runs locally under Docker. `npm run init` created the `lifekey` realm, client, roles and demo users. At 14:00 ICT one licence request succeeded: IGA was switched on, invite links were issued, and doctor-b and doctor-c linked their Tide accounts (14:24).

**What the Tide network blocked.** Between 13:40 and 14:56 ICT, about ten fresh-realm attempts with three different licence emails failed in Tide's licensing service:

- `setUpTideRealm` → `TIDE-IDPEXT-VENDOR-KEYGEN_FAILED`, with `[Midgard] FinalizeWallet failed` as `500 Internal Server Error`, `Not enough orks returned an ok response`, or a 100-second timeout;
- later `[Midgard] InitializeWallet` timed out and fell through to `TIDE-IDPEXT-VENDOR-STRIPE_CHECKOUT_FAILED`.

Creating the remaining Tide accounts failed with `Could not reach enough NEW ORKs (got 6 of 20 required, 13 of 20 failed)`, then `This action isn't available on your current plan … hit its user limit` (free tier `maxUserAcc = 5`, apparently used up by the failed sign-ups). Outbound access to `ork1.tideprotocol.com` from the machine and the container was fine throughout.

**What that means for the demo.** We could not complete the live flow: grants signed by the approver quorum, decryption checked by the ORKs, and the `/proof` checks. The video therefore uses `npm run preview`: the same screens and flow with sample data, and TideCloak **simulated** in the browser: Tide-style sign-in, the token's roles, the 2-of-3 approval quorum and the `RelationshipAttestation:1` checks on every decrypt, with the contract's own refusal messages ([docs/TIDECLOAK-PLAN.md](docs/TIDECLOAK-PLAN.md)). **The video does not prove network enforcement**; that is what the live setup below is for.

**What is verified without the network.** LifeKey's own rules (grant scopes, immutable requests, break-glass and review, hash-chained audit) by `npm test`; building and reading `RelationshipAttestation:1` policy bytes with `@tideorg/js`; and the TideCloak behaviour we rely on, checked against Tide's source code ([`docs/LifeKey-design.md`](docs/LifeKey-design.md), section 6).

---

## Setup

Requirements: Node 20+, Docker (Docker Desktop, or `brew install colima docker && colima start`), `jq`, `curl`.

```bash
npm install
cp .env.example .env              # set KC_BOOTSTRAP_ADMIN_PASSWORD
npm run init                      # starts TideCloak, creates the realm and 5 demo users
npm run dev                       # http://localhost:3000
```

`npm run init` asks for your Tide licence email and your agreement to Tide's Terms & Conditions, then prints five invite links (admin, doctor-a, doctor-b, doctor-c, patient-alice; the licence allows five). Open each in its own browser profile and link a separate Tide account. The full walkthrough, including making doctor-b and doctor-c approvers, is in [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

Look at the screens without TideCloak (sample data, no security):

```bash
npm run preview                   # http://localhost:3100?as=doctor-a
npm run preview:build && npm run preview:start   # same screens, production build: fast, for recording
```

Tests for LifeKey's own rules: `npm test`.

## Where things are

| | |
|---|---|
| Design and Tide facts | [`docs/LifeKey-design.md`](docs/LifeKey-design.md) |
| Grant rules (Tier 1, break-glass, per-request) | `src/lib/lifekey/grants.ts` |
| Immutable requests | `src/lib/lifekey/requests.ts` |
| Break-glass and review | `src/lib/lifekey/breakglass.ts` |
| Building / reading TideCloak policies | `src/lib/tide/policyBytes.ts` |
| Filing grants for the admin quorum | `src/lib/tide/igaServer.ts` |
| Approving from the approver's browser | `src/lib/client/approve.ts` |
| Live checks against the Tide network | `src/app/proof/page.tsx` |
| Phone screenshots | `docs/screenshots/phone/` |
| Desktop screenshots | `docs/screenshots/web/` |
