# Readplace Android POC

A throwaway, dev-only Android app that behaves like the Readplace **browser
extension** (and mirrors the [iOS POC](../ios-readplace-poc)): it lists your saved
links and lets you save new ones by **sharing a URL to it** from any app. When you
share a link, a **share-target Activity** renders the page in a hidden `WebView`
first and uploads the **rendered HTML** (not just the URL) via the server's
`save-html` Siren action — exactly what the extension and the iOS share extension
do.

This is a proof of concept. It is **not** part of the monorepo build (no nx, no
pnpm, no CI). It lives under `experiments/` and touches no other project. It
requires **no server-side changes**: it reuses the existing public OAuth client and
Siren API.

> **On Android, the "extension" is a share target.** Android has no separate
> share-extension binary like iOS. A share target is just an `Activity` with an
> `ACTION_SEND` intent filter in the same app, so it already shares the app's token
> store — no iOS-style App Group is needed.

---

## What it does

- **Sign in** with OAuth 2.0 + PKCE against `https://readplace.com`, reusing the
  extension's public client (`hutch-chrome-extension`) and its registered
  `https://readplace.com/oauth/callback` redirect. The authorize page is shown in an
  in-app `WebView`; the redirect is intercepted to grab the code — the native
  analogue of the extension opening a tab and waiting for the redirect.
- **List** your reading list by walking the Siren API: `GET /` → `303` → `/queue`
  collection, rendering each article (title, site, excerpt, thumbnail, read state),
  with pull-to-refresh, infinite scroll via the `next` link, and delete via each
  item's server-declared `delete` action.
- **Save by sharing**: the **share target** appears in the Android share sheet for
  shared links (delivered as `text/plain`). It loads the page in a hidden `WebView`,
  captures `document.documentElement.outerHTML`, and POSTs `{url, rawHtml, title}` to
  `POST /queue/save-html`. If the token is missing, capture fails, or the HTML is over
  the 10 MiB server limit, it degrades to the URL-only `save-article` path — mirroring
  the extension's own fallback.
- **Save a URL** from inside the app (the `+` field) via the URL-only `save-article`
  action, as a quick way to see the list update.

It speaks `application/vnd.siren+json`, sends `Authorization: Bearer <token>` on every
request, and refreshes the token once on a `401` — the same contract the extension
uses. See [`../../.claude/skills/extension-api-design/SKILL.md`](../../.claude/skills/extension-api-design/SKILL.md).

---

## Architecture: a shared core + a thin Android shell

The logic is split so the interesting part is testable on a plain JDK, with no
Android SDK or emulator:

```
experiments/android-readplace-poc/
├── settings.gradle.kts          # includeBuild("core") + include(":app")
├── build.gradle.kts             # AGP + Kotlin plugins (apply false)
├── gradlew, gradle/wrapper/…    # Gradle wrapper (8.11.1)
├── core/                        # == iOS Shared/ — pure Kotlin/JVM, NO Android deps
│   ├── settings.gradle.kts      #   standalone build → `cd core && ./gradlew test`
│   ├── build.gradle.kts         #   kotlin("jvm") + serialization, JUnit 5
│   └── src/
│       ├── main/kotlin/com/readplace/poc/core/
│       │   ├── AppConfig.kt         #   base URL, client id, Siren media type, limits
│       │   ├── Pkce.kt              #   S256 verifier/challenge (RFC 7636)
│       │   ├── OAuthService.kt      #   authorize URL + token exchange/refresh/revoke
│       │   ├── TokenStore.kt        #   tokens over a KeyValueStore seam
│       │   ├── SirenModels.kt       #   Siren ⇄ Article decoding (kotlinx.serialization)
│       │   ├── ReadplaceApi.kt      #   the Siren walker (list/save/delete)
│       │   ├── UrlDetection.kt      #   first http(s) URL in shared text
│       │   └── http/                #   HttpClient seam + HttpURLConnection impl
│       └── test/kotlin/…            #   == iOS Tests/ — 44 JVM unit tests
└── app/                         # == iOS App/ + ShareExtension/ — Android (needs the SDK)
    └── src/main/
        ├── AndroidManifest.xml      #   MainActivity (LAUNCHER) + ShareActivity (ACTION_SEND)
        ├── kotlin/com/readplace/poc/
        │   ├── AppGraph.kt          #   composition root (wires the core)
        │   ├── platform/            #   SharedPreferences store, WebView HtmlCaptor, share intent
        │   ├── app/                 #   MainActivity, ReadingListViewModel (Jetpack Compose)
        │   ├── ui/                  #   Compose screens (login, OAuth WebView, list, row)
        │   └── share/ShareActivity  #   the share target — the "extension"
        └── res/                     #   brand icons (reused), theme, strings
```

The Android `app` consumes the core through Gradle dependency substitution
(`implementation("com.readplace.poc:readplace-core")` resolves to the included
`core` build), the same way the iOS app compiles `Shared/` into both targets.

---

## Build & run

### Run the core tests with no Android SDK (verified)

The shared core is a plain Kotlin/JVM build, so its tests run on any JDK 17+:

```sh
cd experiments/android-readplace-poc/core
./gradlew test
```

This exercises the real client logic — PKCE, the OAuth flow, Siren decoding, and the
API walker (redirect following, `401` → refresh → retry, `save-html` → `save-article`
fallback, delete) — against a fake HTTP transport, the analogue of the iOS POC's
`StubURLProtocol` suite. **44 tests.**

### Build & install the app (needs the Android SDK)

Like the iOS POC needs a Mac with Xcode, the app module needs the Android SDK. The
easiest path is **Android Studio**:

1. **Open** `experiments/android-readplace-poc/` in Android Studio (Koala / 2024.1+).
   It writes `local.properties` with your `sdk.dir` on first sync.
2. **Run** the `app` configuration on a device or emulator (API 26+).
3. **Sign in** (default server `https://readplace.com`).
4. **Save by sharing**: in Chrome (or anywhere with a link), tap **Share → Save to
   Readplace**. The share target renders the page and saves it; pull-to-refresh in the
   app to see it appear.

Command line (with `ANDROID_HOME`/`local.properties` pointing at an SDK):

```sh
cd experiments/android-readplace-poc
./gradlew :app:assembleDebug      # build the APK
./gradlew :app:installDebug       # install on a connected device/emulator
```

---

## Notes & caveats

- **No server changes.** The app authenticates as the existing `hutch-chrome-extension`
  client and uses its registered HTTPS callback. Custom URL schemes / app-link deep
  links are rejected by the server's redirect allowlist, which is why the flow
  intercepts the HTTPS callback inside the `WebView` (rather than using Chrome Custom
  Tabs, which would need App Links domain verification on `readplace.com`).
- **Google sign-in inside the WebView** may be refused by Google
  ("disallowed_useragent"). The app presents a Chrome-like user agent to reduce this,
  but if Google blocks it, sign in with **email/password** instead — both reach the
  same OAuth consent screen.
- **`minSdk` is 26 (Android 8.0)** so the shared core can use `java.time`,
  `java.util.Base64`, and adaptive icons without desugaring.
- **Token storage is POC-grade** (`SharedPreferences`). A production app would use the
  Android Keystore / `EncryptedSharedPreferences`.
- **App icon** reuses the brand `android-chrome-*.png` assets from
  `projects/hutch/static-assets/` (navy tile, amber marker dot — see
  [BRAND_GUIDELINES.md](../../BRAND_GUIDELINES.md)).
- **Point at a local server** by editing the **Server** field on the sign-in screen.
  Note the OAuth redirect allowlist only accepts `https://readplace.com/oauth/callback`,
  `https://hutch-app.com/oauth/callback`, or `http://127.0.0.1:<port>/oauth/callback`,
  so a LAN-IP base URL won't complete the OAuth redirect without a server-side
  allowlist entry.
