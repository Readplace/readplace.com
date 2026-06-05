#!/usr/bin/env bash
#
# Run fastlane against the REAL Xcode toolchain, with the repo's nix/devbox
# environment scrubbed. The devbox shell exports DEVELOPER_DIR/SDKROOT/CC/CXX/LD
# pointing at a macOS-only nix SDK; those hijack xcodebuild's linker and break
# device archiving. fastlane shells out to xcodebuild/xcrun/xcodegen, so the
# whole invocation must run in a sanitized env.
#
# Usage:  ./scripts/fastlane.sh beta        (or any other lane / fastlane args)

set -euo pipefail
cd "$(dirname "$0")/.."

# Locate the real Xcode (not the nix DEVELOPER_DIR).
XCODE_DEV_DIR=""
for app in /Applications/Xcode.app /Applications/Xcode-*.app; do
	if [ -d "$app/Contents/Developer" ]; then XCODE_DEV_DIR="$app/Contents/Developer"; break; fi
done
if [ -z "$XCODE_DEV_DIR" ]; then
	XCODE_DEV_DIR="$(env -u DEVELOPER_DIR /usr/bin/xcode-select -p)"
fi

# Use the Homebrew Ruby (linked against OpenSSL, not macOS system Ruby's
# LibreSSL) so fastlane match's authenticated encryption works. Its bin
# (ruby/gem/bundle) must win over /usr/bin, so it goes first on PATH.
RUBY_BIN="/opt/homebrew/opt/ruby/bin"

exec env \
	-u CC -u CXX -u CPP -u LD -u SDKROOT -u MACOSX_DEPLOYMENT_TARGET \
	-u CFLAGS -u CXXFLAGS -u CPPFLAGS -u LDFLAGS \
	-u CPATH -u LIBRARY_PATH -u C_INCLUDE_PATH -u CPLUS_INCLUDE_PATH -u OBJC_INCLUDE_PATH \
	DEVELOPER_DIR="$XCODE_DEV_DIR" \
	PATH="$RUBY_BIN:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
	bundle exec fastlane "$@"
