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

# Run the unit tests on a simulator (override SIM as needed).
SIM ?= platform=iOS Simulator,name=iPhone 15
test: generate
	xcodebuild test -project ReadplacePOC.xcodeproj -scheme ReadplacePOC -destination '$(SIM)'

# Remove generated project + build artifacts; sources are the source of truth.
clean:
	rm -rf ReadplacePOC.xcodeproj build
