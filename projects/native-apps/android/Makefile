# Every recipe routes through scripts/ax.sh, which strips the devbox/nix build
# environment before invoking a toolchain command. See that script for why: the
# Gradle daemon snapshots its environment at spawn, so one bare ./gradlew run from
# inside devbox poisons every later build until the daemon is stopped.
#
# There is no `generate` target (the iOS Makefile's first step): Gradle needs no
# project generation — the build files ARE the project.

AX = ./scripts/ax.sh
GRADLE = $(AX) ./gradlew
AVD ?= readplace-android
APK_STAGING = app/build/outputs/apk/staging/debug/app-staging-debug.apk
APPLICATION_ID = com.readplace.android

.PHONY: test test-staging apk apk-staging apk-local emulator-create emulator-boot emulator-window emulator-wait emulator-stop install-emulator install-emulator-local screenshot clean stop

## Full unit suite on the production configuration, the per-file coverage ratchet,
## then the staging configuration's own config pins — mirroring `make test` on iOS.
test:
	$(GRADLE) :app:testProductionDebugUnitTest :app:jacocoTestReport
	$(AX) python3 scripts/check-coverage.py app/build/reports/jacoco/jacocoTestReport/jacocoTestReport.xml
	$(MAKE) test-staging

## Compiles the whole staging variant and runs the pins that assert which server it
## points at, so a broken staging configuration fails here rather than on a device.
test-staging:
	$(GRADLE) :app:testStagingDebugUnitTest --tests '*AppConfigTest'

apk:
	$(GRADLE) :app:assembleProductionDebug

apk-staging:
	$(GRADLE) :app:assembleStagingDebug

## Points at a hutch dev server on this Mac. Pair it with `adb reverse tcp:3000
## tcp:3000` (install-emulator-local does) so the device's localhost is the Mac's.
apk-local:
	$(GRADLE) :app:assembleLocalDebug

install-emulator-local: apk-local
	$(AX) adb reverse tcp:3000 tcp:3000
	$(AX) adb install -r app/build/outputs/apk/local/debug/app-local-debug.apk
	$(AX) adb shell am start -n $(APPLICATION_ID)/.app.MainActivity

emulator-create:
	$(AX) avdmanager create avd --name $(AVD) \
		--package "system-images;android-36;google_apis;arm64-v8a" --device pixel_10

## Boots headless and silent — for scripted runs and screenshots — and waits for
## the OS to finish coming up: the analogue of `simctl bootstatus`, without which
## an install races the boot. `nohup` detaches the emulator from the recipe's
## shell: a windowed instance is torn down with that shell otherwise.
emulator-boot:
	$(AX) sh -c 'nohup $$ANDROID_HOME/emulator/emulator -avd $(AVD) -no-window -no-audio -no-boot-anim >/tmp/readplace-emulator.log 2>&1 &'
	$(MAKE) emulator-wait

## Boots with a window AND audio routed to the Mac's speakers — the one to use
## when a person is watching; the intro theme is inaudible on the headless boot.
emulator-window:
	$(AX) sh -c 'nohup $$ANDROID_HOME/emulator/emulator -avd $(AVD) -no-boot-anim >/tmp/readplace-emulator.log 2>&1 &'
	$(MAKE) emulator-wait

emulator-wait:
	$(AX) adb wait-for-device
	$(AX) sh -c 'while [ "$$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d "\r")" != "1" ]; do sleep 2; done'

## Guarded because `adb emu kill` exits 1 when nothing is running, and a teardown
## you cannot run unconditionally is a teardown nobody runs.
emulator-stop:
	$(AX) sh -c 'adb emu kill 2>/dev/null || true'

install-emulator: apk-staging
	$(AX) adb install -r $(APK_STAGING)
	$(AX) adb shell am start -n $(APPLICATION_ID)/.app.MainActivity

## Reads the device framebuffer, so it needs no visible window and cannot capture
## anything stacked on top — the `simctl io screenshot` analogue.
screenshot:
	@mkdir -p build
	$(AX) sh -c 'adb exec-out screencap -p' > build/screenshot.png
	@echo "wrote build/screenshot.png"

clean:
	$(GRADLE) clean

## Remediation for a daemon that captured a poisoned environment.
stop:
	$(GRADLE) --stop
