#!/bin/bash
set -euo pipefail

ARTICLE="${1:?usage: record-share-demo.sh <article-url> [recorder-latency-ms]}"
LATENCY_MS="${2:-0}"
AX="./scripts/ax.sh"
WORK="build/share-demo"
DEVICE_FILE="/sdcard/share-demo.mp4"

adb() { $AX adb "$@"; }
now_ms() { perl -MTime::HiRes=time -e 'printf "%d", time*1000'; }

mkdir -p "$WORK"
: > "$WORK/events.jsonl"

dump() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb exec-out cat /sdcard/ui.xml 2>/dev/null
}

bounds_of() {
  local attr="$1" value="$2"
  dump | grep -oE "<node[^>]*$attr=\"[^\"]*$value[^\"]*\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" \
    | head -1 | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | grep -oE '[0-9]+'
}

await_node() {
  local attr="$1" value="$2" tries="${3:-20}"
  for _ in $(seq 1 "$tries"); do
    local found
    found=$(bounds_of "$attr" "$value" || true)
    if [ -n "$found" ]; then echo "$found"; return 0; fi
    sleep 1
  done
  echo "timed out waiting for $attr containing '$value'" >&2
  return 1
}

emit() {
  local label="$1" kind="$2" x="${3:-}" y="${4:-}" duration="${5:-}"
  local line="{\"wallMs\":$(now_ms),\"label\":\"$label\",\"kind\":\"$kind\""
  [ -n "$x" ] && line="$line,\"x\":$x,\"y\":$y"
  [ -n "$duration" ] && line="$line,\"durationMs\":$duration"
  echo "$line}" >> "$WORK/events.jsonl"
}

centre_of() {
  local nums=($1)
  echo $(( (${nums[0]} + ${nums[2]}) / 2 )) $(( (${nums[1]} + ${nums[3]}) / 2 ))
}

tap_node() {
  local label="$1" attr="$2" value="$3"
  local point=($(centre_of "$(await_node "$attr" "$value")"))
  emit "$label" tap "${point[0]}" "${point[1]}"
  adb shell input tap "${point[0]}" "${point[1]}"
}

hold_node() {
  local label="$1" attr="$2" value="$3" ms="${4:-900}"
  local point=($(centre_of "$(await_node "$attr" "$value")"))
  emit "$label" long-press "${point[0]}" "${point[1]}" "$ms"
  adb shell input swipe "${point[0]}" "${point[1]}" "${point[0]}" "${point[1]}" "$ms"
}

adb shell am force-stop com.readplace.android
adb shell am start -n com.readplace.android/.app.MainActivity >/dev/null
await_node text "Reading List" 25 >/dev/null || { echo "sign in on the emulator first" >&2; exit 1; }
adb shell am force-stop com.readplace.android

adb shell settings put global sysui_demo_allowed 1
adb shell am broadcast -a com.android.systemui.demo -e command enter >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 -e fully true >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false >/dev/null

adb shell am start -a android.intent.action.VIEW -d "$ARTICLE" com.android.chrome >/dev/null
sleep 8
adb shell input swipe 540 900 540 1900 300
sleep 2
await_node content-desc "(Customize and control|More options)" 25 >/dev/null
sleep 3

adb shell screenrecord --time-limit 170 --bit-rate 20000000 "$DEVICE_FILE" &
RECORDER=$!
STARTED=$(( $(now_ms) + LATENCY_MS ))
sleep 3

tap_node chrome-menu content-desc "(Customize and control|More options)"
sleep 2
tap_node share content-desc "Share…"
sleep 3
hold_node readplace-press text "Readplace"
sleep 2
tap_node pin-readplace text "Pin Readplace"
sleep 3
emit sheet-resorted marker
tap_node readplace text "Readplace"

for _ in $(seq 1 30); do
  focus=$(adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus || true)
  case "$focus" in *com.android.chrome*) break ;; esac
  sleep 1
done
emit back-in-chrome marker
sleep 3

adb shell pkill -2 screenrecord || true
wait "$RECORDER" 2>/dev/null || true
until [ -z "$(adb shell pidof screenrecord 2>/dev/null | tr -d '\r')" ]; do sleep 1; done
adb pull "$DEVICE_FILE" "$WORK/raw.mp4" >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command exit >/dev/null

python3 - "$WORK" "$STARTED" <<'PY'
import json, sys
from pathlib import Path
work = Path(sys.argv[1])
events = [json.loads(line) for line in (work / "events.jsonl").read_text().splitlines() if line.strip()]
take = {"raw": str((work / "raw.mp4").resolve()), "recorderStartedAtMs": int(sys.argv[2]), "syncOffsetMs": 0, "events": events}
(work / "take.json").write_text(json.dumps(take, indent=2) + "\n")
print(f"recorded {take['raw']}")
print(f"next: pnpm --filter hutch media encode android-share-demo --take {(work / 'take.json').resolve()}")
PY
echo "remember: make emulator-stop"
