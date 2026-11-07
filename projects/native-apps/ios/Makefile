.PHONY: ipa ipa-staging generate open test test-staging run-local require-sim clean clean-sim

# Build an UNSIGNED .ipa you can sideload onto your iPhone. Generates the Xcode
# project first (the build script no longer self-generates).
ipa: generate
	./scripts/build-unsigned-ipa.sh

# Same, but built against the deployed staging stack (separate artifact name).
ipa-staging: generate
	READPLACE_ENV=staging ./scripts/build-unsigned-ipa.sh

# Regenerate the Xcode project from project.yml (requires `brew install xcodegen`).
# Routed through a wrapper that keeps the project format openable by Xcode 15.x.
generate:
	./scripts/generate-project.sh

# Generate (if needed) and open in Xcode.
open: generate
	open Readplace.xcodeproj

# Run the unit tests on a simulator. Every Xcode tool goes through scripts/xc.sh,
# which scrubs the devbox/nix toolchain out of the environment — without it
# xcodebuild inherits nix's LD/CC/SDKROOT and every link dies (see xc.sh).
#
# Match the device by UDID, not name: xcodebuild resolves no device from a name
# here, and the UDID is the only stable token on a simctl line. This is the only
# place a device is chosen: CI runs plain `make test` with no SIM override, so a
# snapshot baseline is recorded and verified on the same runtime. Override for a
# specific device, e.g. `make test SIM='platform=iOS Simulator,id=<UDID>'`.
# `make test` runs the production suite and then the staging smoke pass below, so
# the `#if STAGING` build path is compiled on every run — not only when someone
# builds `make ipa-staging` by hand.
#
# `tail -n1`, not `head -n1`: simctl lists runtimes oldest-first, so the *first*
# iPhone belongs to the OLDEST installed runtime — which silently tests against a
# stale iOS, and breaks outright once deploymentTarget rises above it.
#
# Kept lazy (`?=`) so `make clean/ipa/generate` never shell out to a simulator
# probe, but memoised through `$(eval)` so the probe still runs at most once even
# though `$(SIM)` is expanded several times (recipe, SIM_DEVICE, recursive make).
#
# Each checkout gets its own device, Readplace-<hash of this directory>-<runtime>,
# so two checkouts' `make test` runs never install `com.readplace` over each
# other's test host. It is created from the last-listed iPhone's device type and
# runtime, so snapshot baselines stay on the same runtime.
SIM_UDID = $(eval SIM_UDID := $(shell ref=$$(./scripts/xc.sh xcrun simctl list devices available | grep -E '^[[:space:]]+iPhone' | tail -n1 | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}') && [ -n "$$ref" ] && set -- $$(./scripts/xc.sh xcrun simctl list devices available -j | ./scripts/xc.sh python3 -c 'import json,sys; ref,prefix=sys.argv[1:3]; devices=json.load(sys.stdin)["devices"]; runtime,kind=next((key,d["deviceTypeIdentifier"]) for key,ds in devices.items() for d in ds if d["udid"]==ref); name=prefix+runtime.rsplit(".",1)[1]; print(name,kind,runtime,*[d["udid"] for d in devices[runtime] if d["name"]==name])' "$$ref" '$(SIM_NAME_PREFIX)') && { [ -n "$$4" ] && echo "$$4" || ./scripts/xc.sh xcrun simctl create "$$1" "$$2" "$$3"; }))$(SIM_UDID)
SIM_NAME_PREFIX = Readplace-$(shell printf '%s' '$(CURDIR)' | shasum | cut -c1-8)-
SIM ?= platform=iOS Simulator,id=$(SIM_UDID)
# Pull the id/name field out explicitly rather than taking "text after the last
# =": a destination may carry a trailing key (`…,name=iPhone 17,OS=26.5`), which
# would otherwise resolve the device to "26.5".
SIM_DEVICE = $(shell printf '%s' '$(SIM)' | sed -E 's/.*,(id|name)=([^,]*).*/\2/')
SIM_WAS_BOOTED = $(eval SIM_WAS_BOOTED := $(shell ./scripts/xc.sh xcrun simctl list devices booted | grep -o '$(SIM_DEVICE)'))$(SIM_WAS_BOOTED)
COVERAGE_RESULT = build/TestResults.xcresult

# `make test RECORD_SNAPSHOTS=1` re-mints the share card's committed baselines for
# the runtime under test. It has to be exported into xcodebuild's environment, not
# passed as a build setting: xcodebuild forwards TEST_RUNNER_-prefixed variables
# into the test host and ignores an assignment on the command line. A recording run
# always fails, so a flag left set in CI cannot go green.
SNAPSHOT_ENV = $(if $(RECORD_SNAPSHOTS),TEST_RUNNER_READPLACE_RECORD_SNAPSHOTS=$(RECORD_SNAPSHOTS) ,)

# Both test entry points need a simulator, so they fail through one actionable
# message rather than xcodebuild's generic destination dump.
require-sim:
	@test -n "$(SIM_DEVICE)" || { echo "!! No iPhone simulator runtime found to create this checkout's device from. Add one in Xcode > Settings > Components, or pass SIM='platform=iOS Simulator,id=<UDID>'." >&2; exit 1; }

test: generate require-sim
	./scripts/xc.sh xcrun simctl bootstatus '$(SIM_DEVICE)' -b
	rm -rf $(COVERAGE_RESULT)
	$(SNAPSHOT_ENV)./scripts/xc.sh xcodebuild test -project Readplace.xcodeproj -scheme Readplace -destination '$(SIM)' \
		-enableCodeCoverage YES -resultBundlePath $(COVERAGE_RESULT)
	./scripts/xc.sh python3 scripts/check-coverage.py $(COVERAGE_RESULT)
	$(MAKE) test-staging SIM='$(SIM)'
# Shut down only a device this run booted; one the reader booted (run-local) or passed via SIM stays as it was.
	$(if $(filter file,$(origin SIM)),$(if $(SIM_WAS_BOOTED),,./scripts/xc.sh xcrun simctl shutdown '$(SIM_DEVICE)'))

# Compile the STAGING condition and smoke-test it. The full suite can't run under
# STAGING — OAuthServiceTests/LoginFlowTests pin the production redirect URI — so
# this builds the app, extension and test bundle with the STAGING condition
# (proving the staging build is green) and runs only AppConfigTests, whose
# testServerBaseURLMatchesActiveCompilationCondition asserts the `#if STAGING`
# server selection resolves to the staging stack.
test-staging: generate require-sim
	./scripts/xc.sh xcodebuild test -project Readplace.xcodeproj -scheme Readplace -destination '$(SIM)' \
		-only-testing:ReadplaceTests/AppConfigTests \
		SWIFT_ACTIVE_COMPILATION_CONDITIONS=STAGING

run-local: generate require-sim
	./scripts/xc.sh xcrun simctl bootstatus '$(SIM_DEVICE)' -b
	./scripts/xc.sh xcodebuild build -project Readplace.xcodeproj -scheme Readplace -destination '$(SIM)' \
		-derivedDataPath build/DerivedData \
		SWIFT_ACTIVE_COMPILATION_CONDITIONS=LOCAL_SERVER
	./scripts/xc.sh xcrun simctl install '$(SIM_DEVICE)' build/DerivedData/Build/Products/Debug-iphonesimulator/Readplace.app
	./scripts/xc.sh xcrun simctl launch '$(SIM_DEVICE)' com.readplace
	open -a Simulator

# Remove generated project + build artifacts; sources are the source of truth.
clean:
	rm -rf Readplace.xcodeproj build

clean-sim:
	./scripts/xc.sh xcrun simctl list devices -j | ./scripts/xc.sh python3 -c 'import json,sys; prefix=sys.argv[1]; [print(d["udid"],d["name"],d["state"]) for ds in json.load(sys.stdin)["devices"].values() for d in ds if d["name"].startswith(prefix)]' '$(SIM_NAME_PREFIX)' | while read -r udid name state; do \
		if [ "$$state" = Booted ]; then ./scripts/xc.sh xcrun simctl shutdown "$$udid" || exit 1; fi; \
		./scripts/xc.sh xcrun simctl delete "$$udid" || exit 1; echo "Deleted $$name"; \
	done
