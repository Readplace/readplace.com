#!/bin/bash
set -euo pipefail

ARTICLE="${1:?usage: record-share-demo.sh <article-url> <title fragment>}"
TITLE="${2:?usage: record-share-demo.sh <article-url> <title fragment>}"
: "${SIM_UDID:?SIM_UDID must name the simulator to record on}"
: "${READPLACE_EMAIL:?}" "${READPLACE_PASSWORD:?}"

XC="./scripts/xc.sh"
WORK="build/share-demo"
SETTINGS="/tmp/readplace-share-demo.json"

mkdir -p "$WORK"
now_ms() { perl -MTime::HiRes=time -e 'printf "%d", time*1000'; }

python3 - "$SETTINGS" "$READPLACE_EMAIL" "$READPLACE_PASSWORD" "$TITLE" "$PWD/$WORK" <<'PY'
import json, sys
path, email, password, title, work = sys.argv[1:6]
json.dump({
    "email": email,
    "password": password,
    "articleTitle": title,
    "eventsPath": f"{work}/events.jsonl",
    "shotDir": f"{work}/shots",
}, open(path, "w"))
PY

$XC xcrun simctl bootstatus "$SIM_UDID" -b
$XC xcrun simctl ui "$SIM_UDID" appearance light
$XC xcrun simctl status_bar "$SIM_UDID" override --time "9:41" \
  --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState discharging --batteryLevel 100

$XC xcodebuild build-for-testing -project Readplace.xcodeproj -scheme ReadplaceUITests \
  -destination "platform=iOS Simulator,id=$SIM_UDID" -derivedDataPath build/DerivedData >/dev/null

run_test() {
  $XC xcodebuild test-without-building -project Readplace.xcodeproj -scheme ReadplaceUITests \
    -destination "platform=iOS Simulator,id=$SIM_UDID" -derivedDataPath build/DerivedData \
    -only-testing:"ReadplaceUITests/ShareDemoRecording/$1"
}

run_test testSignIn > "$WORK/sign-in.log" 2>&1 || {
  echo "sign-in failed — see $WORK/sign-in.log and $WORK/shots" >&2
  exit 1
}
$XC xcrun simctl terminate "$SIM_UDID" com.readplace >/dev/null 2>&1 || true

$XC xcrun simctl openurl "$SIM_UDID" "$ARTICLE"
sleep 8

$XC xcrun simctl io "$SIM_UDID" recordVideo --codec h264 --display internal --force "$WORK/raw.mp4" \
  > "$WORK/recorder.log" 2>&1 &
until grep -q "Recording started" "$WORK/recorder.log" 2>/dev/null; do sleep 1; done
STARTED=$(now_ms)

run_test testRecordShareDemo > "$WORK/record.log" 2>&1 || {
  pkill -INT -f "simctl io $SIM_UDID recordVideo" || true
  echo "the take failed — see $WORK/record.log" >&2
  exit 1
}

pkill -INT -f "simctl io $SIM_UDID recordVideo" || true
until [ -z "$(pgrep -f "simctl io $SIM_UDID recordVideo" || true)" ]; do sleep 1; done
$XC xcrun simctl status_bar "$SIM_UDID" clear

python3 - "$WORK" "$STARTED" <<'PY'
import json, sys
from pathlib import Path
work = Path(sys.argv[1])
events = [json.loads(line) for line in (work / "events.jsonl").read_text().splitlines() if line.strip()]
take = {
    "raw": str((work / "raw.mp4").resolve()),
    "recorderStartedAtMs": int(sys.argv[2]),
    "syncOffsetMs": 0,
    "events": events,
}
(work / "take.json").write_text(json.dumps(take, indent=2) + "\n")
print(f"recorded {take['raw']}")
print(f"next: pnpm --filter hutch media encode ios-share-demo --take {(work / 'take.json').resolve()}")
PY
rm -f "$SETTINGS"
