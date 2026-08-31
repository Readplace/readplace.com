---
name: android-emulator
description: Run the Readplace Android app in an emulator and see its screen. Use when opening, launching, screenshotting, or recording the app in an Android emulator, when adb reports no device or "offline", or when the emulator will not boot.
---

# Running the app in an emulator

From the Android app's project directory — the one whose Makefile defines the `emulator-boot`
recipe (`git grep -l '^emulator-boot:' -- ':/*/Makefile'`):

```bash
make emulator-boot                 # headless boot of the AVD the Makefile's AVD variable names, waits for boot to finish
make install-emulator              # builds the staging APK, installs it, launches the app
make install-emulator-local        # same against the web server running on this Mac (adb reverse to :3000)
make screenshot                    # prints where it wrote the PNG
make emulator-stop                 # stops it — the last step of a session, not an optional one
```

`emulator-boot` detaches the emulator, so it outlives the command, the task, and the session that
started it, and the AVD is shared by every clone of this repo on the machine — a later session in
another clone attaches to whatever is already booted and never learns it is stale. Nothing else
reaps it. Whoever boots one stops it: run `make emulator-stop` before you finish, including when the
task failed or you are handing back early. Left running it burns CPU cores indefinitely, because its
screen never sleeps and its frames are rasterized on the host CPU.

For `install-emulator-local`, start the web server first: `pnpm nx run hutch:compile`, then, from
the directory of the project that target belongs to (`pnpm nx show project <project> --json`
prints its `root`) with the repo's `.envrc` loaded, run `node` on the compiled entry point its
`start` script names (`pnpm run` lists it) — without the script's `NODE_ENV=production` prefix.
The dev app signs users up without an email round-trip, logs the verification email to stdout,
and rejects a signup posted faster than 2.5 s after its `loadedAt` field — a scripted signup must
send a `loadedAt` a few seconds in the past.

The emulator's Chrome shows its first-run screen the first time a Custom Tab opens; tap
"Use without an account" once and it never returns for that AVD.

Every Gradle/adb/emulator/sdkmanager invocation goes through the wrapper script every toolchain
line of the Makefile is prefixed with — `make -n <target>` prints that prefix. It strips the devbox/nix build
environment, without which AGP's own tool calls resolve a toolchain that cannot produce Android
artifacts. This matters more than on iOS: the **Gradle daemon snapshots its environment at
spawn**, so one bare `./gradlew` run from inside devbox poisons every later build until you run
`make stop`.

For a visible window run `make emulator-window` instead (it also routes audio to the Mac).

## Seeing the screen

`adb exec-out screencap -p > out.png` captures the device framebuffer, needs no visible window,
and ignores whatever is stacked on top — prefer it, and it is what `make screenshot` runs.

To record: `adb shell screenrecord --time-limit 170 /sdcard/out.mp4 &` while a script drives
the app with `adb shell input tap/text/swipe`, stopped with `adb shell pkill -2 screenrecord`
(SIGINT on the device), then `adb pull /sdcard/out.mp4`. Two limits worth knowing before you
plan a capture: the recorder stops itself at **3 minutes**, and killing it without SIGINT
leaves a truncated, unplayable file because the MP4 trailer is written on clean shutdown.
`adb shell input text` cannot type a space — pass a string with spaces through a single
quoted `adb shell "…"` argument, or avoid them.

## Reaching a dev server on the Mac

`adb reverse tcp:3000 tcp:3000` maps the Mac's port into the device, so the app can use the same
`http://localhost:3000` a real device build would. Prefer it over the `10.0.2.2` host alias, which
only works on the emulator and so needs a different app configuration than a device.

## One-time toolchain setup

```bash
brew install openjdk@21                             # formula, not the cask: no sudo needed
brew install --cask android-commandlinetools        # bootstrap only
export ANDROID_HOME="$HOME/Library/Android/sdk"
BOOT=/opt/homebrew/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager
yes | "$BOOT" --sdk_root="$ANDROID_HOME" --licenses   # licences are PER SDK root
"$BOOT" --sdk_root="$ANDROID_HOME" "cmdline-tools;latest" "platform-tools" \
  "platforms;android-36" "build-tools;36.1.0" "emulator" \
  "system-images;android-36;google_apis;arm64-v8a"
make emulator-create
```

Every bootstrap call **must** pass `--sdk_root`: without it the Homebrew copy installs multi-GB
packages into Homebrew's own tree, where a cask upgrade will replace or orphan them.

Use the `google_apis` image, not `google_apis_playstore` — the Play image is non-rootable and adds
nothing the app needs. On Apple Silicon the image must be `arm64-v8a`; x86_64 images do not boot.
`emulator -accel-check` confirms Hypervisor.framework is available.

## adb says "no devices" or "offline"

The emulator registers with the adb server as it boots, so a command issued during boot sees
nothing. `make emulator-boot` already polls `sys.boot_completed`; if you booted by hand, wait for
that property to read `1` before installing.

For a device stuck `offline`, restart the bridge with `adb kill-server` (the next adb command
starts a fresh one). If the emulator itself is wedged, `adb emu kill`, then boot again with
`-no-snapshot-load` — a stale quick-boot snapshot is the usual cause of a device that boots to a
black screen.
