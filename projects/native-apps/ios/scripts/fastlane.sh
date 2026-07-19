#!/usr/bin/env bash
#
# Run fastlane against the REAL Xcode toolchain, with the repo's nix/devbox
# environment scrubbed. The devbox shell exports DEVELOPER_DIR/SDKROOT/CC/CXX/LD
# pointing at a macOS-only nix SDK; those hijack xcodebuild's linker and break
# device archiving. fastlane shells out to xcodebuild/xcrun/xcodegen, so the
# whole invocation must run in a sanitized env.
#
# Usage:  pass a lane (e.g. beta) or any other fastlane args

set -euo pipefail
cd "$(dirname "$0")/.."

# Locate the real Xcode (not the nix DEVELOPER_DIR), preferring the NEWEST one
# installed: App Store Connect requires building with the current iOS SDK
# (Xcode 26+) to upload, so once that is installed — even side by side — the
# build uses it automatically with no path juggling.
XCODE_DEV_DIR=""; newest_ver=""
for app in /Applications/Xcode.app /Applications/Xcode-*.app; do
	[ -d "$app/Contents/Developer" ] || continue
	ver="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist" 2>/dev/null)" || continue
	if [ -z "$newest_ver" ] || [ "$(printf '%s\n%s\n' "$newest_ver" "$ver" | sort -V | tail -1)" = "$ver" ]; then
		newest_ver="$ver"; XCODE_DEV_DIR="$app/Contents/Developer"
	fi
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
