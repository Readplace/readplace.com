#!/usr/bin/env bash
#
# Runs an Android toolchain command with the devbox/nix build environment stripped.
#
# The repo's devbox shell exports CC/CXX/LD/AR/SDKROOT and friends so nix can build
# native code. Gradle passes that environment straight through to AGP's own tool
# invocations (aapt2, d8, zipalign), where a nix `LD` or `SDKROOT` resolves to a
# toolchain that cannot produce Android artifacts. Worse than a one-shot failure:
# the Gradle daemon snapshots its environment at spawn and keeps it for its whole
# lifetime, so a single bare `./gradlew` run from inside devbox poisons every later
# build until the daemon is stopped (`scripts/ax.sh ./gradlew --stop`).
#
# Route EVERY gradle/adb/emulator/sdkmanager invocation through here. This is the
# Android twin of the iOS `scripts/xc.sh`, and exists for the same reason.
#
# Usage: scripts/ax.sh <tool> [args...]
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: scripts/ax.sh <tool> [args...]" >&2
  exit 64
fi

# An externally-supplied JAVA_HOME wins only when it really holds a JDK and does
# not come from nix — that is how CI's setup-java pins its own JDK while a devbox
# shell's value is ignored.
resolve_java_home() {
  if [[ -n "${JAVA_HOME:-}" && -x "${JAVA_HOME}/bin/javac" && "${JAVA_HOME}" != /nix/* ]]; then
    printf '%s' "${JAVA_HOME}"
    return 0
  fi
  local brewed="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
  if [[ -x "${brewed}/bin/javac" ]]; then
    printf '%s' "${brewed}"
    return 0
  fi
  if [[ -x /usr/libexec/java_home ]] && /usr/libexec/java_home -v 21 >/dev/null 2>&1; then
    /usr/libexec/java_home -v 21
    return 0
  fi
  return 1
}

resolve_android_home() {
  if [[ -n "${ANDROID_HOME:-}" && -d "${ANDROID_HOME}/platform-tools" ]]; then
    printf '%s' "${ANDROID_HOME}"
    return 0
  fi
  if [[ -n "${ANDROID_SDK_ROOT:-}" && -d "${ANDROID_SDK_ROOT}/platform-tools" ]]; then
    printf '%s' "${ANDROID_SDK_ROOT}"
    return 0
  fi
  local default="${HOME}/Library/Android/sdk"
  if [[ -d "${default}/platform-tools" ]]; then
    printf '%s' "${default}"
    return 0
  fi
  return 1
}

if ! JAVA_HOME_RESOLVED="$(resolve_java_home)"; then
  echo "ax.sh: no JDK 21 found. Install one with: brew install openjdk@21" >&2
  exit 69
fi

if ! ANDROID_HOME_RESOLVED="$(resolve_android_home)"; then
  echo "ax.sh: no Android SDK found at \$ANDROID_HOME or ~/Library/Android/sdk." >&2
  echo "       See .claude/skills/android-emulator/SKILL.md for the one-time setup." >&2
  exit 69
fi

exec env \
  -u CC -u CXX -u CPP -u LD -u AR -u AS -u NM -u RANLIB -u STRIP -u OBJCOPY -u OBJDUMP \
  -u CFLAGS -u CXXFLAGS -u CPPFLAGS -u LDFLAGS -u SDKROOT -u DEVELOPER_DIR \
  -u CPATH -u LIBRARY_PATH -u C_INCLUDE_PATH -u CPLUS_INCLUDE_PATH -u PKG_CONFIG_PATH \
  -u NIX_CFLAGS_COMPILE -u NIX_LDFLAGS -u NIX_CC -u NIX_BINTOOLS \
  -u MACOSX_DEPLOYMENT_TARGET -u SOURCE_DATE_EPOCH \
  JAVA_HOME="${JAVA_HOME_RESOLVED}" \
  ANDROID_HOME="${ANDROID_HOME_RESOLVED}" \
  ANDROID_SDK_ROOT="${ANDROID_HOME_RESOLVED}" \
  PATH="${JAVA_HOME_RESOLVED}/bin:${ANDROID_HOME_RESOLVED}/platform-tools:${ANDROID_HOME_RESOLVED}/emulator:${ANDROID_HOME_RESOLVED}/cmdline-tools/latest/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  "$@"
