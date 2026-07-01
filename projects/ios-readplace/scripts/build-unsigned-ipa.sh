#!/usr/bin/env bash
#
# Build an UNSIGNED .ipa of Readplace (app + embedded share extension)
# that you can install on your own iPhone with a sideloader (Sideloadly or
# AltStore), which re-signs it with your free Apple ID at install time.
#
# Usage:  make ipa            (production → https://readplace.com)
#         make ipa-staging    (staging   → the deployed staging API Gateway)
#
# Both run `make generate` first: this script does not generate the Xcode
# project itself. To invoke it directly, run `make generate` once beforehand and
# set READPLACE_ENV=staging for a staging build.
#
# Requirements (on your Mac): a full Xcode install and XcodeGen
# (`brew install xcodegen`). No paid Apple Developer account needed.

set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="Readplace"
SYM="$(pwd)/build/sym"
OBJ="$(pwd)/build/obj"

# Which deployment this build targets. `production` (default) → https://readplace.com.
# `staging` sets the STAGING Swift compilation condition so AppConfig.serverBaseURL
# resolves to the staging API Gateway, and names the artifact separately so the
# prod and staging .ipas coexist on disk. The command-line build-setting override
# applies to the app and its embedded ShareExtension in one xcodebuild invocation.
READPLACE_ENV="${READPLACE_ENV:-production}"
case "$READPLACE_ENV" in
	production)
		OUT="build/Readplace-unsigned.ipa"
		STAGING_BUILD_SETTING=""
		;;
	staging)
		OUT="build/Readplace-staging-unsigned.ipa"
		STAGING_BUILD_SETTING="SWIFT_ACTIVE_COMPILATION_CONDITIONS=STAGING"
		;;
	*)
		echo "!! READPLACE_ENV must be 'production' or 'staging', got: '$READPLACE_ENV'" >&2
		exit 1
		;;
esac

# --- Locate the real Xcode toolchain -----------------------------------------
# This repo's devbox/nix shell points DEVELOPER_DIR at a macOS-only SDK and
# exports CC/CXX/LD/SDKROOT/MACOSX_DEPLOYMENT_TARGET that hijack xcodebuild's
# linker. We must run xcodebuild against the real Xcode in a sanitized env.
XCODE_DEV_DIR=""
for app in /Applications/Xcode.app /Applications/Xcode-*.app; do
	if [ -d "$app/Contents/Developer" ]; then XCODE_DEV_DIR="$app/Contents/Developer"; break; fi
done
if [ -z "$XCODE_DEV_DIR" ]; then
	XCODE_DEV_DIR="$(env -u DEVELOPER_DIR /usr/bin/xcode-select -p 2>/dev/null || true)"
fi

# Run an Xcode tool with the nix toolchain scrubbed out of the environment.
xc() {
	local tool="$1"; shift
	env -u CC -u CXX -u CPP -u LD -u SDKROOT -u MACOSX_DEPLOYMENT_TARGET \
		-u CFLAGS -u CXXFLAGS -u CPPFLAGS -u LDFLAGS \
		-u CPATH -u LIBRARY_PATH -u C_INCLUDE_PATH -u CPLUS_INCLUDE_PATH -u OBJC_INCLUDE_PATH \
		DEVELOPER_DIR="$XCODE_DEV_DIR" \
		PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
		"/usr/bin/$tool" "$@"
}

# --- Preflight: the iOS SDK ships only inside the full Xcode app --------------
if ! xc xcrun --sdk iphoneos --show-sdk-path >/dev/null 2>&1; then
	echo "!! The iOS SDK isn't available, so this can't build for a device yet." >&2
	echo "   Install the full Xcode (free) from the Mac App Store, open it once to" >&2
	echo "   finish setup, then re-run: make ipa" >&2
	exit 1
fi

if ! command -v xcodegen >/dev/null 2>&1; then
	echo "==> Installing XcodeGen via Homebrew…"
	brew install xcodegen
fi

echo "==> Cleaning previous build artifacts…"
rm -rf "$SYM" "$OBJ" build/Payload "$OUT"

# Build the app target directly (-target, not -scheme): this links against the
# iphoneos SDK without requiring the iOS *platform* to be registered for a
# destination — which matters on partial Xcode installs missing the platform.
echo "==> Building $TARGET for device ($READPLACE_ENV, code signing disabled)…"
xc xcodebuild \
	-project Readplace.xcodeproj \
	-target "$TARGET" \
	-sdk iphoneos \
	-configuration Release \
	SYMROOT="$SYM" \
	OBJROOT="$OBJ" \
	CODE_SIGNING_ALLOWED=NO \
	CODE_SIGNING_REQUIRED=NO \
	CODE_SIGN_IDENTITY="" \
	${STAGING_BUILD_SETTING:+"$STAGING_BUILD_SETTING"} \
	build

APP="$(find "$SYM/Release-iphoneos" -maxdepth 1 -name '*.app' 2>/dev/null | head -1 || true)"
if [ -z "$APP" ]; then
	echo "!! Build produced no .app under $SYM/Release-iphoneos" >&2
	exit 1
fi

# Ad-hoc sign (no cert needed) with the entitlements so the App Group is
# embedded. Sideloaders (AltStore/Sideloadly) read these embedded entitlements
# when they re-sign; an unsigned app carries none, so the App Group would be
# dropped and the share extension couldn't read the app's token. Sign the
# nested extension first, then the app.
echo "==> Ad-hoc signing with entitlements (App Group survives re-signing)…"
/usr/bin/codesign --force --sign - --timestamp=none \
	--entitlements ShareExtension/ShareExtension.entitlements \
	"$APP/PlugIns/ShareExtension.appex"
/usr/bin/codesign --force --sign - --timestamp=none \
	--entitlements App/App.entitlements \
	"$APP"
echo "   embedded app-group entitlement:"
/usr/bin/codesign -d --entitlements :- "$APP" 2>/dev/null | grep -A1 "application-groups" | sed 's/^/     /' || true

echo "==> Packaging $(basename "$APP") into an .ipa…"
mkdir -p build/Payload
cp -R "$APP" build/Payload/
( cd build && zip -qry "$(basename "$OUT")" Payload )
rm -rf build/Payload

echo ""
echo "✅ Unsigned IPA ready ($READPLACE_ENV): $(pwd)/$OUT"
echo "   Embeds: $(ls "$APP/PlugIns" 2>/dev/null | tr '\n' ' ')"
echo ""
echo "Install it on your iPhone with either:"
echo "  • Sideloadly (https://sideloadly.io) — drag the .ipa, enter your Apple ID, Start."
echo "  • AltStore (https://altstore.io)     — AltStore › My Apps › + › pick the .ipa."
echo ""
echo "Both re-sign with your free Apple ID (7-day profile) and handle the App Group"
echo "so the share extension can read the token the app stores."
