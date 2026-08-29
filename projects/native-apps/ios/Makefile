.PHONY: ipa ipa-staging generate open test test-staging run-local require-sim clean

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
# here, and the UDID is the only stable token on a simctl line (CI matches the
# same way). Override for a specific device, e.g.
# `make test SIM='platform=iOS Simulator,id=<UDID>'`. CI runs `make test`, which
# runs the production suite and then the staging smoke pass below, so the
# `#if STAGING` build path is compiled on every run — not only when someone
# builds `make ipa-staging` by hand.
#
# `tail -n1`, not `head -n1`: simctl lists runtimes oldest-first, so the *first*
# iPhone belongs to the OLDEST installed runtime — which silently tests against a
# stale iOS, and breaks outright once deploymentTarget rises above it.
#
# Kept lazy (`?=`) so `make clean/ipa/generate` never shell out to a simulator
# probe, but memoised through `$(eval)` so the probe still runs at most once even
# though `$(SIM)` is expanded several times (recipe, SIM_DEVICE, recursive make).
SIM_UDID = $(eval SIM_UDID := $(shell ./scripts/xc.sh xcrun simctl list devices available | grep -E '^[[:space:]]+iPhone' | tail -n1 | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}'))$(SIM_UDID)
SIM ?= platform=iOS Simulator,id=$(SIM_UDID)
# Pull the id/name field out explicitly rather than taking "text after the last
# =": a destination may carry a trailing key (`…,name=iPhone 17,OS=26.5`), which
# would otherwise resolve the device to "26.5".
SIM_DEVICE = $(shell printf '%s' '$(SIM)' | sed -E 's/.*,(id|name)=([^,]*).*/\2/')
COVERAGE_RESULT = build/TestResults.xcresult

# Both test entry points need a simulator, so they fail through one actionable
# message rather than xcodebuild's generic destination dump.
require-sim:
	@test -n "$(SIM_DEVICE)" || { echo "!! No iPhone simulator found. Add one in Xcode > Settings > Components, or pass SIM='platform=iOS Simulator,id=<UDID>'." >&2; exit 1; }

test: generate require-sim
	./scripts/xc.sh xcrun simctl bootstatus '$(SIM_DEVICE)' -b
	rm -rf $(COVERAGE_RESULT)
	./scripts/xc.sh xcodebuild test -project Readplace.xcodeproj -scheme Readplace -destination '$(SIM)' \
		-enableCodeCoverage YES -resultBundlePath $(COVERAGE_RESULT)
	./scripts/xc.sh python3 scripts/check-coverage.py $(COVERAGE_RESULT)
	$(MAKE) test-staging SIM='$(SIM)'

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
