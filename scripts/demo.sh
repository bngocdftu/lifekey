#!/usr/bin/env bash
# Run the LifeKey pitch for a demo or a recording: starts the preview app (sample data, TideCloak
# simulated) on port 3100 if it is not already running, and opens the presentation at /pitch.html,
# which plays the four parts and drives the live app (about 2 minutes).
#
#   scripts/demo.sh            open the pitch; use → / ← / P to step or play
#   scripts/demo.sh --auto     open it playing from the start, after a 3-2-1 countdown
#   scripts/demo.sh --record   also record the screen with ffmpeg, then write docs/demo.mp4
#   scripts/demo.sh --rebuild  rebuild the preview first (after code changes)
#
# --record needs ffmpeg (brew install ffmpeg) and Screen Recording permission for your terminal
# (System Settings → Privacy & Security). Pick another screen with SCREEN="Capture screen 1".
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=3100
AUTO=0 RECORD=0 REBUILD=0
for a in "$@"; do
  case "$a" in
    --auto) AUTO=1 ;;
    --record) RECORD=1 AUTO=1 ;;
    --rebuild) REBUILD=1 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

up() { curl -fs -o /dev/null "http://localhost:$PORT/pitch.html"; }

[ -d node_modules ] || npm install

if up; then
  echo "Using the app already running on port $PORT."
else
  if [ "$REBUILD" = 1 ] || [ ! -f .next-preview/BUILD_ID ]; then
    echo "Building the preview (about a minute)…"
    npm run preview:build >/dev/null
  fi
  echo "Starting the preview on port $PORT (log: .preview.log)…"
  nohup npm run preview:start >.preview.log 2>&1 &
  for _ in $(seq 1 60); do up && break; sleep 1; done
  up || { echo "The preview did not start; see .preview.log" >&2; exit 1; }
fi

URL="http://localhost:$PORT/pitch.html"
[ "$AUTO" = 1 ] && URL="$URL?auto=1"

open_url() { if command -v open >/dev/null; then open "$1"; elif command -v xdg-open >/dev/null; then xdg-open "$1"; else echo "Open $1"; fi; }

if [ "$RECORD" = 0 ]; then
  open_url "$URL"
  echo "Pitch: $URL"
  echo "Full screen the browser (Cmd+Ctrl+F) and record with Cmd+Shift+5 if you like."
  exit 0
fi

command -v ffmpeg >/dev/null || { echo "ffmpeg is missing: brew install ffmpeg" >&2; exit 1; }
RAW=".demo-raw.mov"
SECS="${SECS:-128}"   # 3 s countdown + about 2 minutes of pitch + a little slack
open_url "$URL"
echo "Recording ${SECS}s of \"${SCREEN:-Capture screen 0}\". Bring the browser to the front, full screen."
ffmpeg -y -loglevel error -f avfoundation -framerate 30 -capture_cursor 1 -i "${SCREEN:-Capture screen 0}:none" -t "$SECS" "$RAW"
# Cut the countdown, scale to 1080p, compress well under the 100 MB limit.
ffmpeg -y -loglevel error -ss 3 -i "$RAW" -vf "scale=-2:1080,fps=30" -c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -movflags +faststart -an docs/demo.mp4
rm -f "$RAW"
ls -lh docs/demo.mp4
