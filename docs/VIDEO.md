# Recording the demo video (2 minutes)

Organisers' requirements: an `.mp4` file, under 100 MB, placed in the repo (e.g. `docs/demo.mp4`), about 2 minutes long, in 4 parts: the new possibility, the constraint, the prototype and TideCloak's role, what changes.

## Fastest way: the scripted pitch

```bash
scripts/demo.sh --auto     # starts the preview if needed, opens /pitch.html and plays it (about 2 minutes)
scripts/demo.sh --record   # same, and records the screen into docs/demo.mp4 (needs ffmpeg)
```

`/pitch.html` walks through the four parts and drives the live app in a frame (sign in, emergency alerts, two approvers, right and wrong doctor, proof checks, patient view). Without `--auto`, step with → and ←, and press P to play. Full screen the browser (Cmd+Ctrl+F) before recording.

## Run the preview on the recording machine

Requires Node 20 or later (`node -v`). No Docker or TideCloak needed.

```bash
git clone https://github.com/bngocdftu/lifekey.git
cd lifekey
npm install
npm run preview:build    # once, about a minute
npm run preview:start    # fast production build of the preview on port 3100
```

Record with `preview:start`, not `npm run preview`. The dev server compiles each page the first time it opens and ships much larger scripts, so page switches can take seconds, especially from a phone on the same Wi-Fi. Stop any `npm run preview` first: both use port 3100. After changing the code, run `npm run preview:build` again.

Open http://localhost:3100. Switch accounts by adding `?as=...` to the end of the address, or click the name at the bottom of the left sidebar:

| Account | Address |
|---|---|
| Doctor A (requests access, breaks glass) | http://localhost:3100/?as=doctor-a |
| Doctor B (approver) | http://localhost:3100/approve?as=doctor-b |
| Doctor C (approver) | http://localhost:3100/approve?as=doctor-c |
| Patient Alice (consent, sees who opened the record) | http://localhost:3100/me?as=patient-alice |
| Records office | http://localhost:3100/setup?as=admin |

The sample data is kept in this browser, so switching account keeps what the last account did (Alice's request shows up in Doctor B's queue). Before each take, click **Reset sample data** at the bottom of the left sidebar to start from the same state. To record the phone layout: Chrome → right-click → Inspect → turn on the phone icon (Toggle device toolbar) → choose iPhone 14.

Screen recording on macOS: `Cmd + Shift + 5` → Record Selected Portion. On Windows: `Win + Alt + R` (Xbox Game Bar).

## Script

| Time | Say | On screen |
|---|---|---|
| 0:00–0:20 **The new possibility** | "3 a.m., an unconscious patient arrives in the ER. The doctor needs to know right away that the patient is on an anticoagulant, is allergic to penicillin and has a mechanical heart valve." | `?as=doctor-a` → open **Patient**. Scroll slowly past the 4 emergency alerts and the QR code card. |
| 0:20–0:40 **The constraint** | "Ordinary systems let the server and admins hold the keys: hack the server, or be one insider, and you can read every record. So hospitals don't dare open detailed records widely." | Still on the patient page, point at **Detailed records**: each record needs its own read grant. |
| 0:40–1:15 **Prototype: requesting access and 2 approvers** | "Doctor A asks to read the medication list. TideCloak creates a grant for A only, for this record only, expiring after 2 hours. The grant takes effect only once 2 approvers sign it with their own Tide accounts." | Click **Request access** on the record card, enter a reason, send. Switch to `/approve?as=doctor-b` → select the request → the grant card shows a **1/2 signatures** ring → **Approve**. Switch to `?as=doctor-c` → sign → **2/2**. |
| 1:15–1:35 **Prototype: the Tide network blocks the wrong person and the wrong record** | "Even if the grant and the ciphertext leak, the Tide network still refuses anyone else, including the approver who just signed that grant, and a read grant for MED-204 cannot open MED-205. The server cannot sign on anyone's behalf either." | `/proof?as=doctor-b` → the table of checks (B2 uses A's grant → denied). |
| 1:35–1:50 **Break glass** | "When there's no time to wait, the on-duty doctor immediately opens the records the patient allowed in advance. Everyone is notified, and two people review it within 72 hours." | `?as=doctor-a` → **Break glass** on the medication list card. Then `/approve?as=doctor-b` → the **Break-glass** tab. |
| 1:50–2:00 **What changes** | "Patients let emergency teams see what matters without exposing everything. No admin, server or AI can open a record on its own." | Back to the patient page. LifeKey logo. |

## Honesty note for the video

The preview uses sample data and is not connected to the Tide network. Say one short sentence at the end or put a caption on screen:

> "TideCloak was really integrated and initialised (realm, licence, 5 demo accounts). On 22 Oct the Tide ORK network was failing (only 6 of 20 nodes responded), so we recorded the approval flow in preview mode."

If possible, insert 5–10 seconds of screen recording of the "Could not reach enough NEW ORKs (got 6 of 20 required)" error as evidence.

## Compress the video to under 100 MB

```bash
ffmpeg -i demo-raw.mov -vf "scale=1280:-2" -c:v libx264 -crf 28 -preset veryfast -c:a aac -b:a 96k docs/demo.mp4
```

Without ffmpeg: macOS QuickTime → File → Export As → 720p is also usually under 100 MB for 2 minutes.
