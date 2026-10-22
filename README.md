# LifeKey

**Emergency doctors see the alerts that keep a patient alive immediately, while the full record opens only for one named doctor, one record and a short time, approved by two people and enforced by the Tide network rather than by our server.**

<!-- Project overview: 300 words or fewer. Replace the headings below with the organisers' template if they differ. -->

**The possibility.** An unconscious patient arrives at 3 a.m. The ER doctor needs to know about warfarin, a penicillin allergy and a mechanical heart valve now, and sometimes needs the full medication history too, without anyone being able to browse every record "just in case".

**The constraint.** In today's systems whoever runs the server, or holds an admin account, can read or grant access to everything. Patients and hospitals cannot share detailed records widely because one compromised server or one insider exposes all of them, and "break-the-glass" is only a checkbox an admin can bypass.

**The prototype and TideCloak's role.** Every record is encrypted on its own. Each read grant is a TideCloak policy (`RelationshipAttestation:1`) that names one doctor's Tide key, one record and an expiry, and it only exists once two approvers sign it through TideCloak's quorum. The Tide network checks doctor, record, operation and expiry on every decryption. Emergency summaries are pre-approved for verified clinicians; break-glass opens only records the patient pre-authorised, for on-duty ER doctors, with mandatory review afterwards.

**Why ordinary login is not enough.** With normal login and backend permissions, our server would hold the keys and decide who reads what. Here the server only stores ciphertext and cannot sign a grant: a leaked grant fails for another doctor, a MED-204 grant cannot open MED-205, and the server cannot approve on anyone's behalf. The `/proof` page runs these checks live.

**What changes.** Patients can let emergency teams see what matters without exposing everything. Hospitals can prove that no single admin, server or AI can open a record alone.

Synthetic data only. Demo video: [`docs/demo.mp4`](docs/demo.mp4).

---

## Setup

Requirements: Node 20+, Docker (Docker Desktop, or `brew install colima docker && colima start`), `jq`, `curl`.

```bash
npm install
cp .env.example .env              # set KC_BOOTSTRAP_ADMIN_PASSWORD
npm run init                      # starts TideCloak, creates the realm and 5 demo users
npm run dev                       # http://localhost:3000
```

`npm run init` asks for your Tide licence email and your agreement to Tide's Terms & Conditions, then prints five invite links (admin, doctor-a … doctor-d). Open each in its own browser profile and link a separate Tide account. The full walkthrough, including making doctor-b and doctor-c approvers, is in [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

Look at the screens without TideCloak (sample data, no security):

```bash
npm run preview                   # http://localhost:3100?as=doctor-a
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
