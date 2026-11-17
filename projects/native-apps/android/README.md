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
make test                 # unit suite + pixel tests + coverage ratchet + staging config pins; RECORD_SNAPSHOTS=1 re-records the pictures
make emulator-stop        # stop the emulator — it outlives your shell, so this is not optional
```

The emulator detaches from the shell that starts it, and its AVD is shared with every other clone
of this repo on the machine, so nothing else will stop it. Whoever runs `emulator-boot` runs
`emulator-stop`.

`scripts/record-share-demo.sh <article-url>` records the share-sheet demo the web serves from
`/help/add-links?platform=android`. It drives Chrome's menu, the share sheet, the long-press pin and
the save, then writes a take the hutch media toolkit encodes — see
[its runbook](../../hutch/scripts/media/README.md). It needs the app installed and signed in on a
visible emulator (`make emulator-window`), and it unpins Readplace itself between takes so the
recording can teach the pinning.

The script stops before recording when the app is signed out. Unlike the iOS recording, it
deliberately does not sign in by itself: sign-in here is the server's sign-in and consent pages in
a Chrome Custom Tab, so a sign-in driver would have to be edited whenever those pages are reworded,
as the iOS driver was on 2026-10-16, and all it would save is one manual sign-in.

Every toolchain invocation goes through `scripts/ax.sh`. See
[`.claude/skills/android-emulator/SKILL.md`](../../../.claude/skills/android-emulator/SKILL.md)
for the one-time SDK setup and the emulator troubleshooting.

## Releasing

CI's `android-play-publish` job uploads every change to the app's shipping code to Play's
internal testing track (see `.github/workflows/publish-android-play.yml`). Production is a
promotion of a tested internal release in Play Console, the counterpart of submitting a
TestFlight build for App Store review.

- **Version code.** Each upload takes the next `android-readplace@v<N>` tag and pushes the
  tag before uploading, the same scheme as iOS. Play refuses a version code it has seen, so a
  failed upload only skips a number. Debug builds stay at version code 1.
- **Upload key.** Play App Signing holds the key that signs what users install. CI signs with
  the upload key in the `prod` environment's `ANDROID_UPLOAD_KEYSTORE_BASE64` and
  `ANDROID_UPLOAD_KEYSTORE_PASSWORD` secrets, alias `upload`. A lost upload key is reset
  through Play Console support; it never locks the app.
- **A local signed bundle.** `make bundle VERSION_CODE=<n>` with `READPLACE_UPLOAD_KEYSTORE`
  and `READPLACE_UPLOAD_KEYSTORE_PASSWORD` set. Without them the build fails at
  `validateSigningProductionRelease` rather than producing an unsigned bundle Play rejects.
- **Store listing.** The Play listing's text and images live under
  `fastlane/metadata/android/<locale>/` in fastlane supply's own layout, and the manual
  **Publish Android Play listing** workflow pushes them. Play's limits as of 2026-11-12:
  title 30 characters, short description 80, full description 4,000, and 2 to 8 phone
  screenshots. Text files carry no final newline, because supply sends them verbatim. An
  unticked run writes the listing into a Play edit, asks Play to validate it and discards
  it, so readers see no change; a run with `publish` ticked commits the edit, and Play
  publishes it after review. Only the owner dispatches a `publish` run; an agent never
  does. The `prod` environment has no required reviewer, so dispatching the run is the
  whole publish act. The run names the internal track only because supply looks up one release there;
  it uploads no binary and changes no track.

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

**No Chrome-first URL opening, and no browser sign-in handoff.** The iOS app signs
in inside itself and opens readplace.com links Chrome-first, so a tapped link can
land in a browser the reader never signed in through. iOS therefore rewrites the
link for Chrome and, since 2026-10-30, signs that browser in with a single-use code
(the `create-browser-handoff` Siren action, redeemed at `GET /auth/handoff`).
Android has no such split: sign-in runs in a Custom Tab of the default browser and
leaves a persistent `hutch_sid` session there, and our-host links are handed to that
same browser untouched. The server offers the handoff action on every collection;
this app does not call it. A browser that has lost its session (cookies cleared, a
changed default browser, about 180 days with no web visit) asks for one sign-in,
and `/login?return=` then lands the reader on the page they tapped. Build the
handoff once a reader is seen landing signed out, not before.

**A downloaded EPUB goes to Downloads, not a share sheet.** Tapping Download EPUB
hands the file to the system downloader, which writes it into the public Downloads
collection and posts the notification that opens it in the reader's EPUB app. iOS
has no such public collection, which is why it offers the file to a share sheet;
Android's share sheet has no "save to device" target, so a share-only flow would
lose keeping the file. The system names the file and de-duplicates the name, so the
app needs no filename rule and no temporary directory. The download request carries
the WebView's cookies for our own article link, so a file only its owner may read,
such as an uploaded book, downloads like any other. The downloader sends those
headers again on every redirect it follows, so the EPUB route must not redirect to
another host.

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
`captureBlocked`, `statusChanged` — are unchanged. `markedRead` is terminal and
latched once per sheet: it closes the sheet and re-reads the list. `statusChanged`
is neither, so the reader's own Next Read confirmation can mark an article read,
stay open, and swap the suggestion in while the list reconciles behind it.
A fourth message, `captureAvailable`, is posted when the page offers to capture a
failed article. The app acts on it once per article per device, and never while a
capture is already running: it evaluates
`document.dispatchEvent(new Event("readplace-capture-started"))` in the reader, which
the server's markup turns into the capture poll, and uploads the hidden render with
`captureTrigger=automatic`, so the server judges it like a crawl instead of trusting
it as the reader's own capture. The app names the event and nothing more, so what the
page does with it can change without an app release. A failed automatic capture is
logged under the `Capture` tag rather than shown (an expired session still signs the
app out), and the capture button stays as the retry.
When any capture, tapped or automatic, ends without uploading a copy, the app
evaluates `document.dispatchEvent(new Event("readplace-capture-failed"))`, so the page
ends "Copying the page from your device" at once instead of polling until it gives
up. After a tapped capture the page says the copy from the device didn't arrive;
after an automatic one it returns to the notice it showed before. A capture that
uploaded a copy dispatches nothing; the page's poll picks the copy up.

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
sign in against before they are deployed.

**Cleartext is app-wide for WebViews, https-only for native requests.** The main
`network_security_config.xml` permits cleartext app-wide, because the capture and
reader WebViews must load http-only article pages — the same reason iOS carries the
`NSAllowsArbitraryLoadsInWebContent` ATS exception, and Android has no per-WebView
cleartext exception to scope it more tightly. The app's own OkHttp clients (API,
OAuth, external content fetch) are held to https by `NativeCleartextPolicy`, a
network interceptor installed at each client-building composition root and inherited
by every client cloned from them, so a redirect hop is gated too. The `local` flavor
passes that interceptor the loopback dev hosts (`localhost`, `127.0.0.1`, `10.0.2.2`)
so sign-in against the Mac's dev server still works; production and staging permit no
native cleartext at all. This replaced the old localhost-only network-security config
that lived in the `local` flavor's manifest overlay, which could not have opened
cleartext for arbitrary article WebViews without also opening it for native requests.

**No HTTP cache on the app's API client.** iOS gives its API session a 10 MB disk URL
cache and reads the list with a revalidating cache policy. That cache was added to hold
the offline list; JSON snapshots took that job over the same day, so all it still does
is let an unchanged list answer `304` with no body. The server builds the whole listing
before it can answer `304` and varies the list on `Authorization`, so the saving is one
response body, and only until the next token refresh. This app's API client is built
with no cache instead. The server lets a native client keep the list for an hour so the
share target can save without rediscovering, and archiving or deleting a row never
invalidates that copy, so a cached app client would show a stale list on any read that
forgot to force revalidation. Every list read here goes to the origin in full; only the
share target's client opts into the discovery cache.

**Compile-time environment via a product flavor.** iOS selects its server with
`#if STAGING`; here the `production`/`staging` flavors set `BuildConfig.SERVER_BASE_URL`.
Same property: the server is fixed at build time, there is no runtime override, and
`make test-staging` compiles the staging variant and runs the pins that assert which
server it points at.

**Not phone-only.** iOS ships iPhone-only and full-screen to keep iPad out of App
Store review scope and its screenshot set (the `TARGETED_DEVICE_FAMILY` setting in
`../ios/project.yml`). Play has no such scope, and from Android 16 the system by
default ignores an app's orientation and resizability restrictions on displays 600dp
and wider once it targets API 36, as this app does. So the manifest restricts nothing,
and the app can run on tablets and in split screen with the phone layout.

**No draft listing on Play, and no read-back.** iOS pushes its listing to an App Store
Connect draft and reads the screenshots back, because App Store Connect's processing delay
once doubled every screenshot. Play's API has no draft a caller can choose: an edit is
committed or discarded, so a validate-only run stands in for the draft. A Play edit is one
transaction and supply skips an image whose checksum Play already holds, so there is
nothing to read back.

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
on a simulator only because Xcode offers no other way. The iOS suite also measures the
share chooser's layout: touch-target floors on the narrowest window and at the smallest
text size. Android measures the same chooser in one Robolectric Compose test at set
window sizes and font scales, the largest font and landscape included. Otherwise
Robolectric is used only where a framework type is genuinely unavoidable (Intent/ClipData
reading, and drawing a Compose leaf for a pixel test); the decision cores are deliberately
kept off `android.*` so they stay plain-JVM testable.

Pixel tests draw a Compose leaf in light and dark and compare it with a picture
committed under `app/src/test/pixel-baselines/`, with the iOS comparison rule and
tolerances. `make test RECORD_SNAPSHOTS=1` records them again and always fails.

`scripts/check-coverage.py` enforces the same per-file ratchet the iOS app uses,
against JaCoCo's XML instead of an `.xcresult`: files listed in
`coverage-baseline.json` under `excluded` are OS-boundary or pure-layout, files under
`floors` must hold their recorded minimum, and **a file in neither must be 100%** so a
new logic file cannot land untested. A report that measures nothing fails loudly
rather than passing on emptiness.
