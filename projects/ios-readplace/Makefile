.PHONY: ipa ipa-staging generate open test test-staging clean

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

# Run the unit tests on a simulator. The runner image's device set varies, so
# default to the first available numbered iPhone; override for a specific one,
# e.g. `make test SIM='platform=iOS Simulator,name=iPhone 16 Pro'`. CI runs
# `make test`, which runs the production suite and then the staging smoke pass
# below, so the `#if STAGING` build path is compiled on every run — not only when
# someone builds `make ipa-staging` by hand.
SIM ?= platform=iOS Simulator,name=$(shell xcrun simctl list devices available | grep -m1 -oE 'iPhone [0-9]+')
test: generate
	xcodebuild test -project Readplace.xcodeproj -scheme Readplace -destination '$(SIM)'
	$(MAKE) test-staging SIM='$(SIM)'

# Compile the STAGING condition and smoke-test it. The full suite can't run under
# STAGING — OAuthServiceTests/LoginFlowTests pin the production redirect URI — so
# this builds the app, extension and test bundle with the STAGING condition
# (proving the staging build is green) and runs only AppConfigTests, whose
# testServerBaseURLMatchesActiveCompilationCondition asserts the `#if STAGING`
# server selection resolves to the staging stack.
test-staging: generate
	xcodebuild test -project Readplace.xcodeproj -scheme Readplace -destination '$(SIM)' \
		-only-testing:ReadplaceTests/AppConfigTests \
		SWIFT_ACTIVE_COMPILATION_CONDITIONS=STAGING

# Remove generated project + build artifacts; sources are the source of truth.
clean:
	rm -rf Readplace.xcodeproj build
