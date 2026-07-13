#!/usr/bin/env bash
#
# Run a system/Xcode tool (xcodebuild, xcrun, python3, …) with this repo's
# devbox/nix toolchain scrubbed out of the environment.
#
# WHY: `xcodebuild` treats environment variables as build-setting overrides, and
# the devbox/nix shell exports a full parallel toolchain — CC/CXX/LD/AR/… plus a
# DEVELOPER_DIR and SDKROOT pointing at a nix macOS-only SDK. So `LD=ld` silently
# replaces Xcode's link *driver* (clang) with the bare linker, which then cannot
# parse the clang driver flags Xcode still passes, and every link dies with:
#
#     ld: -objc_abi_version '-Xlinker' not supported (expected 2)
#
# The nix DEVELOPER_DIR also makes xcodebuild resolve the wrong simulator set,
# and a nix `xcrun` shim shadows Apple's on PATH. CI never hits any of this (its
# runner has no devbox), which is why only local builds broke.
#
# Every Xcode entry point MUST go through this one helper: the bug it fixes was
# caused by exactly that drift — the .ipa build sanitised its env while `make
# test` did not, so `make test` was unbuildable inside the repo's own shell.
#
# Usage: scripts/xc.sh xcodebuild …   scripts/xc.sh xcrun …   scripts/xc.sh python3 …

set -euo pipefail

# A real Xcode developer dir always ships `usr/bin/xcodebuild`; the nix one ships
# only an `xcrun` shim. That is the discriminator, so an intentional
# DEVELOPER_DIR (CI's setup-xcode pins the Xcode version through it) is honoured
# and only the nix one is replaced.
is_xcode_dir() { [ -n "${1:-}" ] && [ -x "$1/usr/bin/xcodebuild" ]; }

XCODE_DEV_DIR=""
if is_xcode_dir "${DEVELOPER_DIR:-}"; then
	XCODE_DEV_DIR="$DEVELOPER_DIR"
else
	candidate="$(env -u DEVELOPER_DIR /usr/bin/xcode-select -p 2>/dev/null || true)"
	if is_xcode_dir "$candidate"; then
		XCODE_DEV_DIR="$candidate"
	else
		# Pick the NEWEST installed Xcode, not the first in glob order — the same
		# rule scripts/fastlane.sh uses to pick the archiving toolchain. If they
		# disagreed, a side-by-side install would test on one Xcode and ship on
		# another.
		newest_ver=""
		for app in /Applications/Xcode.app /Applications/Xcode-*.app /Applications/Xcode_*.app; do
			is_xcode_dir "$app/Contents/Developer" || continue
			ver="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist" 2>/dev/null)" || continue
			if [ -z "$newest_ver" ] || [ "$(printf '%s\n%s\n' "$newest_ver" "$ver" | sort -V | tail -1)" = "$ver" ]; then
				newest_ver="$ver"
				XCODE_DEV_DIR="$app/Contents/Developer"
			fi
		done
	fi
fi
if [ -z "$XCODE_DEV_DIR" ]; then
	echo "!! No Xcode developer directory found. Install Xcode and open it once." >&2
	exit 1
fi

if [ $# -eq 0 ]; then
	echo "usage: scripts/xc.sh <tool> [args…]   e.g. scripts/xc.sh xcodebuild -version" >&2
	exit 2
fi
tool="$1"
shift

# PATH is pinned to the system paths so `xcrun` — and anything a tool shells out
# to — resolves to Apple's, not nix's shim. Safe because the project declares no
# Run Script build phases that would need a third-party tool on PATH.
exec env \
	-u CC -u CXX -u CPP -u LD -u AR -u AS -u NM -u RANLIB \
	-u STRIP -u STRINGS -u SIZE -u OBJCOPY -u OBJDUMP \
	-u SDKROOT -u MACOSX_DEPLOYMENT_TARGET \
	-u CFLAGS -u CXXFLAGS -u CPPFLAGS -u LDFLAGS -u OBJCFLAGS \
	-u CPATH -u LIBRARY_PATH -u C_INCLUDE_PATH -u CPLUS_INCLUDE_PATH -u OBJC_INCLUDE_PATH \
	DEVELOPER_DIR="$XCODE_DEV_DIR" \
	PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
	"/usr/bin/$tool" "$@"
