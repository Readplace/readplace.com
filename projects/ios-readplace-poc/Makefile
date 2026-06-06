.PHONY: ipa generate open test clean

# Build an UNSIGNED .ipa you can sideload onto your iPhone (one command).
ipa:
	./scripts/build-unsigned-ipa.sh

# Regenerate the Xcode project from project.yml (requires `brew install xcodegen`).
# Routed through a wrapper that keeps the project format openable by Xcode 15.x.
generate:
	./scripts/generate-project.sh

# Generate (if needed) and open in Xcode.
open: generate
	open ReadplacePOC.xcodeproj

# Run the unit tests on a simulator. The runner image's device set varies, so
# default to the first available numbered iPhone; override for a specific one,
# e.g. `make test SIM='platform=iOS Simulator,name=iPhone 16 Pro'`.
SIM ?= platform=iOS Simulator,name=$(shell xcrun simctl list devices available | grep -m1 -oE 'iPhone [0-9]+')
test: generate
	xcodebuild test -project ReadplacePOC.xcodeproj -scheme ReadplacePOC -destination '$(SIM)'

# Remove generated project + build artifacts; sources are the source of truth.
clean:
	rm -rf ReadplacePOC.xcodeproj build
