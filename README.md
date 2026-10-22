# LifeKey

[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

_An emergency medical passport: ER doctors see life-saving alerts at once; each full record opens only for one named doctor, briefly, after two approvals enforced by the Tide network._

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

### 1. Vision & originality

A QR code on the patient's card shows clinicians an emergency summary. Detailed records stay sealed one by one: a doctor requests one, two colleagues approve, access expires automatically. Patients choose what break-glass may open and see every opening.

### 2. Trust constraint insight

Whoever runs the server or holds an admin account can read or grant everything. One breach or insider exposes every patient, and "break the glass" is a bypassable checkbox. So hospitals keep records locked, even when a life depends on them. Without that single point of trust, records can be shared narrowly and provably.

### 3. Value & impact

3 a.m., an unconscious patient: the doctor instantly sees warfarin, a penicillin allergy and a mechanical heart valve, and gets the full medication list within minutes. Hospitals can show that no single admin, server or AI opens a record alone.

### 4. Why TideCloak matters

Each record is encrypted separately. A read grant is a TideCloak `RelationshipAttestation:1` policy naming one doctor's Tide key, one record and an expiry. It exists only after two approvers (never the requester) sign through TideCloak's quorum, and the Tide network checks doctor, record and expiry on every decryption. Our server holds only ciphertext and cannot sign; a leaked grant fails for anyone else.

### 5. Prototype & storytelling

Doctor A sees the alerts; Doctor C signs A's request in the Tide enclave (2 of 2); A reads the record, B is refused; the proof page runs attacks. Video: [`docs/demo.mp4`](docs/demo.mp4). Tide's network failed on submission day, so the demo simulates TideCloak ([details](docs/TIDECLOAK-PLAN.md)). Synthetic data.

## Setup

Requirements: Node 20+. For the live TideCloak setup also Docker (Docker Desktop, or `brew install colima docker && colima start`), `jq` and `curl`.

**Demo (no TideCloak needed).** Sample data, TideCloak simulated in the browser, not secure:

```bash
npm install
scripts/demo.sh --auto            # starts the preview on :3100 and plays the pitch at /pitch.html
npm run preview                   # or just the app: http://localhost:3100/?as=doctor-a
```

**Live TideCloak.**

```bash
npm install
cp .env.example .env              # set KC_BOOTSTRAP_ADMIN_PASSWORD
npm run init                      # starts TideCloak, creates the realm and 5 demo users
npm run dev                       # http://localhost:3000
```

`npm run init` asks for your Tide licence email and your agreement to Tide's Terms & Conditions, then prints invite links for admin, doctor-a, doctor-b, doctor-c and patient-alice. Link each to its own Tide account in a separate browser profile. Making doctor-b and doctor-c approvers and the remaining steps are in [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

**Tests** for LifeKey's own rules (grant scopes, immutable requests, break-glass review, audit chain, simulated TideCloak checks): `npm test`.

### Status on submission day (22 Oct 2026)

TideCloak `0.14.41` ran locally and the `lifekey` realm was created, but Tide's licensing service kept failing (`TIDE-IDPEXT-VENDOR-KEYGEN_FAILED`, `[Midgard] FinalizeWallet failed`, `Could not reach enough NEW ORKs`), so the approver quorum and ORK-checked decryption could not be run end to end. The demo therefore does not prove network enforcement; the live setup above is how to check it. The code paths for the live network are in `src/lib/tide/`.

### Where things are

| | |
|---|---|
| Design and Tide facts | [`docs/LifeKey-design.md`](docs/LifeKey-design.md) |
| Where TideCloak fits, and the simulation | [`docs/TIDECLOAK-PLAN.md`](docs/TIDECLOAK-PLAN.md) |
| Grant rules, requests, break-glass | `src/lib/lifekey/` |
| TideCloak policies, quorum filing | `src/lib/tide/` |
| Approving from the approver's browser | `src/lib/client/approve.ts` |
| Proof checks | `src/app/proof/page.tsx` |
| Screenshots | `docs/screenshots/` |
