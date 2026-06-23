#!/usr/bin/env bash
#
# Generate the Xcode project from project.yml, then rewrite the project format
# number down to one older Xcode versions can open.
#
# XcodeGen 2.45+ emits `objectVersion = 77` (Xcode 16+). The project uses only
# classic PBXGroup/PBXFileReference objects (no Xcode-16 synchronized folders),
# so the older format is fully compatible — this just lets Xcode 15.x open it.

set -euo pipefail
cd "$(dirname "$0")/.."

xcodegen generate

PBXPROJ="Readplace.xcodeproj/project.pbxproj"
/usr/bin/sed -i '' 's/objectVersion = [0-9]\{1,\};/objectVersion = 56;/' "$PBXPROJ"
