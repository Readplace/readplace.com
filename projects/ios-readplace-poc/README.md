# Readplace iOS POC

A throwaway, dev-only iPhone app that behaves like the Readplace **browser
extension**: it lists your saved links and lets you save new ones by **sharing a
URL to it** from any app. When you share a link, the app renders the page in a
hidden `WKWebView` first and uploads the **rendered HTML** (not just the URL) via
the server's `save-html` Siren action — exactly what the extension does.

This is a proof of concept that lives under `projects/` as an nx project
(`ios-readplace-poc`). It builds with its own Swift/fastlane toolchain rather
than pnpm, and its code touches no other project. It requires **no server-side
changes**: it reuses the existing public OAuth client and Siren API.

---

## ⚡ Quickstart — get it on your iPhone

Everything runs on **your Mac** (the iOS SDK only comes with Xcode, so there's no
way around installing it once). One-time setup, then one command, then install.

**One-time setup (≈30 min, free):**

1. Install **Xcode** from the Mac App Store. Open it once and let it finish
   ("Install additional components"). This gives you the iOS SDK.
2. Install **Homebrew** (https://brew.sh) if you don't have it, then:
   ```sh
   brew install xcodegen
   ```

**The command — build the app (run in this folder):**

```sh
cd projects/ios-readplace-poc
make ipa
```

That produces `build/Readplace-unsigned.ipa` (the app + its share extension).

**Put it on your iPhone (no paid account needed):**

3. Install **Sideloadly** (https://sideloadly.io) on your Mac and open it.
4. Plug your iPhone in with a cable and tap **Trust** on the phone.
5. In Sideloadly: drag in `build/Readplace-unsigned.ipa`, type your normal
   **Apple ID**, click **Start**. It signs the app with your Apple ID and
   installs it. (If 2FA asks, you may need an app-specific password from
   appleid.apple.com.)
6. On the iPhone: **Settings → General → VPN & Device Management →** tap your
   Apple ID → **Trust**.
7. Open **Readplace**, sign in (server `https://readplace.com`), and to save a
   page tap **Share → Readplace** from Safari.

> The free signature lasts **7 days**; re-run `make ipa` and re-install in
> Sideloadly to renew. Prefer an all-GUI route with no extra app? See
> *"Alternative: build & run from Xcode"* below — Xcode's **Run** button does the
> signing and install for you.

---

## What it does

- **Sign in** with OAuth 2.0 + PKCE against `https://readplace.com`, reusing the
  extension's public client (`hutch-chrome-extension`) and its registered
  `https://readplace.com/oauth/callback` redirect. The authorize page is shown
  in an in-app `WKWebView`; the redirect is intercepted to grab the code — the
  native analogue of the extension opening a tab and waiting for the redirect.
- **List** your reading list by walking the Siren API: `GET /` → `303` → `/queue`
  collection, rendering each article (title, site, excerpt, thumbnail, read
  state), with pull-to-refresh, infinite scroll via the `next` link, and
  swipe-to-delete via each item's server-declared `delete` action.
- **Save by sharing**: a **Share Extension** appears in the iOS share sheet for
  URLs/web pages. It loads the page in an off-screen `WKWebView`, captures
  `document.documentElement.outerHTML`, and POSTs `{url, rawHtml, title}` to
  `POST /queue/save-html`. If the token is missing, capture fails, or the HTML is
  over the 10 MiB server limit, it degrades to the URL-only `save-article` path —
  mirroring the extension's own fallback.
- **Save a URL** from inside the app (the `+` button) via the URL-only
  `save-article` action, as a quick way to see the list update.

It speaks `application/vnd.siren+json`, sends `Authorization: Bearer <token>` on
every request, and refreshes the token once on a `401` — the same contract the
extension uses. See [`../../.claude/skills/extension-api-design/SKILL.md`](../../.claude/skills/extension-api-design/SKILL.md).

---

## Layout

```
projects/ios-readplace-poc/
├── project.yml                  # XcodeGen spec (source of truth for the project)
├── Makefile                     # make ipa / generate / open / test / clean
├── scripts/build-unsigned-ipa.sh  # one command → installable unsigned .ipa
├── App/                         # the SwiftUI app target (lists + sign-in)
├── ShareExtension/              # the share-sheet target (renders + saves)
├── Shared/                      # code compiled into BOTH targets
│   ├── AppConfig.swift          #   base URL, client id, App Group id
│   ├── PKCE.swift               #   S256 verifier/challenge
│   ├── OAuthService.swift       #   authorize URL + token exchange/refresh/revoke
│   ├── TokenStore.swift         #   tokens in the shared App Group
│   ├── SirenModels.swift        #   Siren ⇄ Article decoding
│   ├── ReadplaceAPI.swift       #   the Siren client (list/save/delete)
│   ├── URLDetection.swift       #   first http(s) URL in shared text
│   └── HTMLCaptor.swift         #   WKWebView → document.documentElement.outerHTML
└── Tests/                       # XCTest unit tests (URLProtocol-stubbed network)
```

The `.xcodeproj` is generated from `project.yml` by
[XcodeGen](https://github.com/yonaskolb/XcodeGen). It's committed for
convenience; regenerate anytime with `make generate` (`brew install xcodegen`).

---

## One command → installable unsigned build

From a Mac with Xcode's command-line tools and `brew install xcodegen`:

```sh
cd projects/ios-readplace-poc
make ipa
```

This generates the project, builds the app **with code signing disabled**, and
packages it (with the embedded share extension) into
`build/Readplace-unsigned.ipa`.

A stock iPhone can't run a *truly* unsigned binary, so you install the IPA with a
sideloader that re-signs it with your **free Apple ID** at install time — no paid
account, no Xcode project fiddling:

- **Sideloadly** (https://sideloadly.io): drag the `.ipa`, enter your Apple ID, **Start**.
- **AltStore** (https://altstore.io): **My Apps → + →** pick the `.ipa`.

Both also wire up the **App Group**, so the share extension can read the token the
app stores. The free-account signature lasts 7 days; re-run `make ipa` and
re-install to renew.

Run the tests with `make test` (boots a simulator).

---

## Alternative: build & run from Xcode (dev signing)

You need a Mac with **Xcode 15+** and an Apple ID (a free personal team is fine).

1. **Open the project**
   ```sh
   cd projects/ios-readplace-poc
   make open          # or: open ReadplacePOC.xcodeproj
   ```

2. **Set a unique bundle id + your team** (both targets). Bundle ids are globally
   unique on Apple's side, so the placeholder `com.example.readplacepoc` will
   likely need changing:
   - Select the **ReadplacePOC** target → **Signing & Capabilities** → set
     **Team** to your Apple ID and change the **Bundle Identifier** to something
     unique, e.g. `com.<you>.readplacepoc`.
   - Select the **ShareExtension** target and do the same, keeping it a child of
     the app id, e.g. `com.<you>.readplacepoc.ShareExtension`.

3. **Confirm the App Group** (both targets share one). Under **Signing &
   Capabilities** both targets list an **App Groups** entry
   `group.com.example.readplacepoc`. Keep them identical on both targets. If
   Xcode flags it, click to register it (App Groups work with a free personal
   team). If you change the id, also update `AppConfig.appGroupId` in
   `Shared/AppConfig.swift` to match.

4. **Plug in your iPhone**, select it as the run destination, and press **Run**.
   The first time, approve the developer certificate on the phone under
   *Settings → General → VPN & Device Management*.

5. **Sign in** in the app (default server `https://readplace.com`).

6. **Save by sharing**: in Safari (or anywhere with a link), tap **Share → 
   Readplace**. The extension renders the page and saves it; pull-to-refresh in
   the app to see it appear.

> Free personal teams give a 7-day provisioning profile, so the app stops
> launching after a week until you re-run it from Xcode. That's expected for a
> dev POC.

---

## Tests

`make test` (or `Cmd+U` in Xcode) runs the XCTest suite. The network is stubbed
with a `URLProtocol`, so tests exercise the real client logic — headers, bodies,
redirects, retries — without a server. Coverage focuses on boundaries and edge
cases:

- **Siren decoding**: rich vs. minimal entities, JSON `null` image/`readAt`,
  read-state from `status`/`readAt`, title fallback to URL, entities without
  properties dropped, empty collections, `next`/`prev` pagination, collection
  warnings, ISO-8601 dates with/without fractional seconds, error bodies with and
  without a fallback action.
- **PKCE**: the RFC 7636 verifier→challenge vector, verifier length/alphabet,
  URL-safe challenge, uniqueness.
- **OAuth**: authorize-URL parameters, code exchange body + token storage,
  refresh keeping vs. replacing the refresh token, failure paths, revoke clears
  tokens.
- **API**: entry-point `303` redirect with the `Authorization` header preserved,
  `401` → single refresh → retry (and no retry loop when refresh fails),
  `save-html` body + fallback to URL-only on an error action, `save-article`,
  delete returning the refreshed collection with the `Prefer` header, `404` →
  not-found, and missing-token handling.
- **TokenStore / URL detection**: persistence and partial-token edge cases;
  http(s)-only link extraction that ignores `mailto:`/`tel:`.

## Notes & caveats

- **App icon.** The app ships a brand icon — a navy serif ampersand with the
  warm-amber marker dot (see [BRAND_GUIDELINES.md](../../BRAND_GUIDELINES.md)) — in
  an `Assets.xcassets` catalog, regenerated from the brand geometry by
  `scripts/make-appicon.sh`. Compiling the catalog (`actool`) needs the iOS
  **platform/simulator runtime** installed (`xcodebuild -downloadPlatform iOS`),
  the same prerequisite as device archiving; on a partial Xcode with only the
  device SDK the build fails at `actool` until the platform is installed.
- **Builds from the repo's devbox shell.** `build-unsigned-ipa.sh` scrubs the
  nix toolchain env (`CC`/`CXX`/`LD`/`SDKROOT`/…) and points at the real Xcode,
  and builds the app target with `-target` (not `-scheme`) so it links against
  the `iphoneos` SDK without needing the iOS *platform* registered for a
  destination. Verified building against Xcode 15.4 (iOS 17.5 SDK).

- **Google sign-in inside the web view** may be refused by Google
  ("disallowed_useragent"). The app presents a Safari-like user agent to reduce
  this, but if Google blocks it, sign in with **email/password** instead — both
  reach the same OAuth consent screen.
- **Tapping an item** opens the original article URL in an in-app Safari view.
  The server's reader (`/queue/{id}/view`) needs a cookie session this
  token-based POC doesn't hold, so it isn't used.
- **No server changes**: the app authenticates as the existing
  `hutch-chrome-extension` client and uses its registered HTTPS callback. Custom
  URL schemes are rejected by the server's redirect allowlist, which is why the
  flow intercepts the HTTPS callback inside the web view.
- **Point at a local server** by editing the **Server** field on the sign-in
  screen (e.g. your machine's LAN address). Note the OAuth redirect allowlist
  only accepts `https://readplace.com/oauth/callback`,
  `https://hutch-app.com/oauth/callback`, or `http://127.0.0.1:<port>/oauth/callback`,
  so a LAN-IP base URL won't complete the OAuth redirect without a server-side
  allowlist entry.
