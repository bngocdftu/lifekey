# RUNBOOK: running the LifeKey prototype on a real TideCloak

Goal: see for yourself that the Tide network **allows** the right grant and **denies** every wrong one (the `/proof` page).

## View the UI without TideCloak

```bash
npm install
npm run preview      # http://localhost:3100 (dev server, compiles pages on first open)
# For a smooth demo or video, use the production build of the preview instead:
# npm run preview:build && npm run preview:start
```

This mode replaces the Tide SDK with a stand-in and uses sample data; it is only for looking at the UI. Switch accounts with `?as=doctor-a` (or `admin`, `doctor-b`, `doctor-c`, `patient-alice`), or click the name at the bottom of the left sidebar. Results on the Proof page in this mode prove **nothing**, because there is no real Tide network.

## 0. Prerequisites

- Docker Desktop (macOS), Node 20+, `jq`, `curl` (`brew install jq`)
- **5 browser profiles** (Chrome → Add profile), each with its own Tide account: `admin`, `doctor-a`, `doctor-b`, `doctor-c`, `patient-alice` (the licence allows up to 5 accounts)
- Ask the Tide team (Discord https://discord.gg/XBMd9ny2q5) whether the network behind `tideorg/tidecloak-dev` has the **`RelationshipAttestation:1`** contract yet (ORK build from 16/10/2026). If not, stop here.

## 1. Initialise

```bash
cp .env.example .env          # set KC_BOOTSTRAP_ADMIN_PASSWORD
npm install
npm run init
```

The script asks for the **email that manages the Tide licence** and whether you **agree to the Terms & Conditions** (https://tide.org/legal). You must answer both yourself.

The script prints **5 invite links**. Open each link in **that person's own profile** and create/link a Tide account. The script waits for all 5, grants `tide-realm-admin` to `admin` (the realm switches to multiAdmin), then exports `data/tidecloak.json`.

## 2. Run the app

```bash
npm run dev      # http://localhost:3000
```

Log in once in each of the 5 profiles (so LifeKey records each person's Tide key).

## 3. Make B and C approvers (3 admins → threshold 2)

In the TideCloak admin console (`http://localhost:8080/admin/master/console/#/lifekey`), in the `admin` profile:

1. Users → `doctor-b` → Role mapping → Assign role → filter by client `realm-management` → select **`tide-realm-admin`** and **`manage-realm`**.
2. Go to Change Requests → approve (enclave pop-up). There is only 1 admin at this point, so the threshold = 1.
3. Repeat for `doctor-c`. Approve as `admin` (with B added the threshold is still `floor(0.7×2) = 1`).
4. If there is a `REGEN_ADMIN_POLICY` change request, approve it too. After this step the threshold is `floor(0.7×3) = 2`.
5. B and C log out and back in so their tokens carry the new role.

Check: on the LifeKey home page, B and C show the **tide-realm-admin (approver)** badge. `doctor-a` is **never** given this role.

## 4. Enrollment (profile `patient-alice`, then `admin`)

0. Profile `patient-alice` → `/me` → **My consent**: turn on "Allow break-glass" for MED-204, choose the emergency card content → **Sign consent**. Until this is signed, `/setup` cannot file any grant.
1. `/setup` → **Send to approvers**: creates 6 change requests (4 write grants, 1 Tier 1, 1 break-glass).
2. Profile B → `/approve` → select all → **Approve** (one pop-up for the whole batch) → each item `1/2`.
3. Profile C → `/approve` → **Approve** → `COMMITTED`.
4. Profile `admin` → `/setup` → **Reload**: all `SIGNED`. If any row says `FAILED`, see Troubleshooting.
5. **Import 4 sample records**: the admin's browser encrypts 4 records; the server stores only ciphertext.
6. (Optional, for the demo) Set `LIFEKEY_DEMO_SEED=1` in `.env` and restart the app. Have `doctor-a` and `patient-alice` log in once, then `admin` → `/setup` → **Create sample requests**: 2 requests from A (MED-204, MED-205), 1 read request from the patient (T1-PAT-001), 1 break-glass. All of them still wait for B and C to really sign.

## 5. Demo

| Step | Profile | Do | See |
|---|---|---|---|
| 1 | A | `/emergency/p_8f29a1` | Tier 1: warfarin, penicillin, heart valve |
| 2 | A | ALERT-88 → *View source record* → reason → Send | REQ-1042 `PENDING_APPROVAL` |
| 3 | A | `/proof` → run | A1 *skipped* (no grant yet) |
| 4 | B | `/approve` → approve REQ-1042 | `1/2` |
| 5 | A | Reload | Still `PENDING_APPROVAL`: one signature is not enough |
| 6 | C | `/approve` → approve | `COMMITTED` |
| 7 | A | Reload → **Read record** on MED-204 | Medication list |
| 8 | A | `/proof` → run | A1 PASS (allowed); A2–A6 PASS (denied); A7 allowed (known limit); A8 allowed (views alerts) |
| 9 | B | `/proof` → run | B1, B2 (using the grant just signed for A: *subjectId does not match*), B3 denied |
| 10 | A | MED-204 → **Break glass** → reason | Readable at once; B/C see an item to review |
| 11 | B, C | `/approve` → review | `JUSTIFIED` or `FLAGGED` |
| 12 | admin, B | `/proof` | R1, B1 denied; S1: the server cannot record a signature |
| 13 | anyone | `/audit` | Hash chain intact |
| 14 | patient-alice | `/me` | Who has read the record, the break-glass notice from step 10, how long the REQ-1042 grant has left |
| 15 | patient-alice | `/me` → turn off MED-204 → sign version 2 | Repeating step 10 is denied by LifeKey; the grant already signed on the network stays valid until it expires |
| 16 | patient-alice | `/me` → **Ask to read my record** → T1-PAT-001 | Request pending; B, C see "Patient request" in the queue |
| 17 | B | `/approve` → select the request → **Ask the requester** | The requester sees the question on their request |
| 18 | B, C | Sign the patient's request | The patient clicks **Read record** and decrypts in their own browser |
| 19 | patient-alice | `/me` → the break-glass → **Tell the reviewers** | B, C see the patient's comment when reviewing |

Testing expiry: create a new request, let it expire (or lower `DEFAULT_TTL_SECONDS` in `src/app/api/emergency-requests/route.ts` to 120 seconds), then run A1 again. Expected: denied.

## 6. Record the evidence

Take screenshots of `/proof` for A, B and admin; save them in `docs/proof/`. This is the evidence for section 6 of the design doc.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Could not reach enough VVK ORKs` right after a "must deny" check | **That is the denial.** The contract's reason is in `cause` (the `/proof` page prints it) |
| Signing a policy reports unknown contract | The network does not have `RelationshipAttestation:1` yet: ask the Tide team |
| `/setup` reports `FAILED: signed policy does not match` | TideCloak re-encoded the policy to different bytes: send the details to the Tide team (point 6.3.2 in the design doc) |
| `has not been allowed a voucher action of type vendordecrypt` | Missing the voucher role `_tide_x.selfdecrypt`, or the user has not logged in again after being granted the role |
| `/approve` returns HTTP 403 | The approver lacks `manage-realm` or has not logged in again |
| The enclave pop-up does not open | Allow pop-ups for `localhost:3000`; you must click Approve yourself (not through automation) |
| Threshold is still `1` with 3 admins | `REGEN_ADMIN_POLICY` has not been approved (step 3.4) |
| `master token: HTTP 401` | Wrong `KC_BOOTSTRAP_ADMIN_PASSWORD` in `.env` |
