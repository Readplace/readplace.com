# Readplace for Android

A port of the [iOS app](../ios/README.md). The behaviour is the same app: the same
Siren hypermedia client, the same OAuth+PKCE sign-in, the same share-to-save flow,
the same chromeless in-app reader. Read the iOS README for what the app *does* —
this file records only what Android forced to differ, and why.

## Running it

```bash
make emulator-boot        # headless boot of the readplace-android AVD
make install-emulator     # staging APK → installed → launched
make screenshot           # build/screenshot.png
make test                 # unit suite + coverage ratchet + staging config pins
make emulator-stop        # stop the emulator — it outlives your shell, so this is not optional
```

The emulator detaches from the shell that starts it, and its AVD is shared with every other clone
of this repo on the machine, so nothing else will stop it. Whoever runs `emulator-boot` runs
`emulator-stop`.

Every toolchain invocation goes through `scripts/ax.sh`. See
[`.claude/skills/android-emulator/SKILL.md`](../../../.claude/skills/android-emulator/SKILL.md)
for the one-time SDK setup and the emulator troubleshooting.

## What differs from iOS, and why

**One process, one binary.** iOS ships an app *and* a share extension, two binaries
that share nothing but an App Group. Android's share target is an `Activity` in the
same APK, so the entire App Group layer disappears: no shared container, no keychain
access group, no provisioning-profile group-id resolution, no legacy-defaults
migration. Storage roots are plain injected `File`s under the app's own
`filesDir`/`cacheDir`.

That also removes the background-upload machinery. iOS needs a background
`URLSession` because the share extension is killed the moment its sheet closes; the
Android share Activity hands its staged job to the same process that will drain it.
Uploads drain when the app next opens, exactly as they do on iOS.

**No Chrome-first URL opening.** `ChromeFirstURL` exists on iOS because the OS
default browser is usually Safari while the user actually browses in Chrome, so a
readplace.com link would open somewhere they are not signed in. Android's default
browser *is* the browser they use, and it carries their cookie jar, so our-host
links are handed to the system untouched.

**A distinct OAuth redirect.** The iOS app is registered against
`readplace://oauth-callback`; this app is registered against
`readplace://oauth-callback/android`. Redirect URIs are matched by exact string per
client, so the shared prefix is inert — but reusing the iOS URI would let either app
redeem a code minted for the other.

**A Chrome user agent on the WebViews.** iOS sends a Safari UA so sites serve their
normal page to the capture WebView rather than degrading it for an unrecognised
embedded view. Android's own WebView UA carries a `; wv` token that draws the same
degradation, so this app sends a stock Chrome-on-Android UA for the same reason.

**A different JS bridge shape.** The reader bridge script is server-authored and now
resolves either host: WKWebView's `webkit.messageHandlers.readplaceReader` is checked
first and left byte-identical for shipped iOS builds, and this app registers
`addJavascriptInterface(bridge, "ReadplaceReader")` whose `postMessage` takes the
JSON-serialised message, because that is the only shape an
`addJavascriptInterface` method can receive. The messages themselves — `markedRead`,
`captureBlocked` — are unchanged.

**Transcoded intro media.** The iOS bundle ships `LaunchIntroTheme.caf` (Core Audio,
which Android cannot decode) and `LaunchIntro.mp4` encoded as **10-bit HEVC** (which
Android's software decoder rejects with `NO_EXCEEDS_CAPABILITIES`, so it never plays
on an emulator and not on every device). The Android copies under `res/raw/` are the
same assets transcoded once — AAC in an `.m4a`, and 8-bit H.264 — with the visible
frames and audible loop unchanged.

**A `local` flavor.** Android's `local` flavor (the counterpart of iOS's
`LOCAL_SERVER` condition, `make run-local`) points at a hutch dev server on the
Mac through `adb reverse`, because the server
changes that register the Android client have to exist somewhere the emulator can
sign in against before they are deployed. It opens cleartext for localhost only, in
its own manifest overlay, so production and staging stay strict.

**Compile-time environment via a product flavor.** iOS selects its server with
`#if STAGING`; here the `production`/`staging` flavors set `BuildConfig.SERVER_BASE_URL`.
Same property: the server is fixed at build time, there is no runtime override, and
`make test-staging` compiles the staging variant and runs the pins that assert which
server it points at.

## Version pins that are not "the latest"

Two dependencies are deliberately held back, both for the same reason: their AAR
metadata demands `compileSdk 37`, and Google does not publish an `android-37`
platform in any SDK channel yet, so a build against them cannot be produced at all.

- **Compose 1.11** (1.12 requires 37; 1.11 requires 35)
- **OkHttp 5.4** (5.5 requires 37; 5.4 requires 36)

Both carry a comment in `gradle/libs.versions.toml` saying to lift them once
platform 37 ships. Everything else is current.

## Testing

Unit tests run on the JVM (JUnit4 + `mockwebserver3`), not on an emulator. The iOS
suite is the same shape — pure logic tests with the OS boundaries excluded — and ran
on a simulator only because Xcode offers no other way. Robolectric is used only where
a framework type is genuinely unavoidable (Intent/ClipData reading); the decision
cores are deliberately kept off `android.*` so they stay plain-JVM testable.

`scripts/check-coverage.py` enforces the same per-file ratchet the iOS app uses,
against JaCoCo's XML instead of an `.xcresult`: files listed in
`coverage-baseline.json` under `excluded` are OS-boundary or pure-layout, files under
`floors` must hold their recorded minimum, and **a file in neither must be 100%** so a
new logic file cannot land untested. A report that measures nothing fails loudly
rather than passing on emptiness.
