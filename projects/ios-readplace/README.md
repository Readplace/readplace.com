# Readplace iOS

An iPhone app that behaves like the Readplace **browser
extension**: it lists your saved links and lets you save new ones by **sharing a
URL to it** from any app. When you share a link, the app renders the page in a
hidden `WKWebView` first and uploads the **captured content** (the rendered HTML,
or a shared PDF's bytes — not just the URL) via the server's `save-content` Siren
action — exactly what the extension does.

It lives under `projects/` as an nx project
(`ios-readplace`). It builds with its own Swift/fastlane toolchain rather
than pnpm, and its app code touches no other project. It authenticates with its
own public OAuth client (`ios-app`), registered server-side in
`built-in-clients.ts`, and otherwise reuses the existing Siren API.

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
cd projects/ios-readplace
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
7. Open **Readplace**, tap **Login** (the build targets `https://readplace.com`),
   and to save a page tap **Share → Readplace** from Safari.

> The free signature lasts **7 days**; re-run `make ipa` and re-install in
> Sideloadly to renew. Prefer an all-GUI route with no extra app? See
> *"Alternative: build & run from Xcode"* below — Xcode's **Run** button does the
> signing and install for you.

---

## What it does

- **Sign in** with OAuth 2.0 + PKCE against `https://readplace.com`, using the
  app's own public client (`ios-app`). The authorize page opens
  in the **external browser** via the same flow as **Sign up** (below), carrying
  `screen_hint=login` so a logged-out user lands on the web `/login` page and
  returns authenticated through the native `readplace://oauth-callback` deep link.
- **Sign up** by opening `/oauth/authorize` in the **external browser**,
  Chrome-first: it rewrites to `googlechromes://` and opens Chrome, falling back to
  the default browser only if the system reports Chrome can't be opened (not
  installed) — so an existing Chrome session is reused rather than the app landing
  in the default browser (usually Safari), where the user isn't signed in. The
  redirect is a native `readplace://oauth-callback` deep
  link and the request carries `screen_hint=signup`: an already-logged-in Chrome
  passes straight to consent, while a new/logged-out user lands on the web
  `/signup` page and returns authenticated. This mirrors the browser extension's
  tab-based flow (which an in-app web view can't, since it can't see Chrome's
  cookies); the in-flight PKCE secrets are persisted to the App Group so a cold
  relaunch via the deep link can still finish the token exchange. **Login uses
  this identical flow**, differing only in the `screen_hint`.
- **List** your reading list by walking the Siren API from the one entry point
  it knows, following whatever the server hands back: the collection (unread
  only), each article (title, site, excerpt, thumbnail, read state), with
  pull-to-refresh, infinite scroll via the `next` link, and swipe-to-**mark-read**
  via each item's server-declared status action (the marked row leaves the unread
  list; the article is kept, not deleted). The client follows the server's hrefs,
  link `rel`s and action/field names — never hard-coded URLs — so a server view
  change needs no app release. A link or action advertised without an href is
  treated as read-only.
- **Read in-app**: tapping a row opens the server's authenticated reader
  (Readplace reader content + AI summary) in a `WKWebView`, not the original
  source site. The sheet opens immediately on a skeleton while the app mints a
  browser session cookie from its bearer token and injects it into the web view;
  the reader and its in-reader XHRs are then authenticated. Pressing the reader's
  own **Mark as read** closes the sheet and drops the row; **View original** stays
  reachable from inside the reader. The reader's mark-read is detected by the
  `status` field on its request, not its URL, so the endpoint can move freely.
- **Save by sharing**: a **Share Extension** appears in the iOS share sheet for
  URLs/web pages, plain text, and PDF documents — via a SUBQUERY
  `NSExtensionActivationRule` predicate ([`ShareExtension/Info.plist`](./ShareExtension/Info.plist)
  explains why the dictionary keys cannot express PDF support without accepting
  every file type). For a page, it loads the URL in an off-screen `WKWebView`,
  captures `document.documentElement.outerHTML`, and uploads it as a
  `multipart/form-data` `{url, mediaType, title, content}` body to
  `POST /queue/save-content`. A PDF the payload carries as a file is uploaded
  as-is (no render, no refetch); a shared URL that merely resolves to a PDF is
  fetched directly (the web view declines to render it) and uploaded as
  `application/pdf`. Both PDF routes respect the same 25 MiB client ceiling and
  require the `%PDF-` magic header. If capture fails, or a shared PDF is blocked
  or oversized, it degrades to the URL-only `save-article` path — and the
  server's crawler, which allows far larger PDFs, then fetches it. (A payload
  that instead exceeds the *server's* cap comes back with that same URL-only
  fallback action.) A PDF shared with no web link at all (e.g. straight from
  Files) reports "No link found to save." — articles are keyed by URL.
- **Add links via Share**: the `+` button is a client-side control — an
  `add-links-help` affordance the app injects itself and treats as canonical,
  ignoring (deduping) any the server also advertises. It opens a sheet whose
  `WKWebView` renders the server's help page at a client-held path
  (`AppConfig.addLinksHelpPath`), so the instructions ship via a hutch deploy
  rather than an App Store release. A **Back to Queue** button
  dismisses it. There is no in-app paste box; capturing a page is the Share
  Extension's job, and the server's `save-article` URL-only action is reached only
  through that Share flow, never the toolbar.

It speaks `application/vnd.siren+json`, sends `Authorization: Bearer <token>` on
every request, and refreshes the token once on a `401` — the same contract the
extension uses. See [`../../.claude/skills/hypermedia-api-design/SKILL.md`](../../.claude/skills/hypermedia-api-design/SKILL.md).

---

## Layout

```
projects/ios-readplace/
├── project.yml                  # XcodeGen spec (source of truth for the project)
├── Makefile                     # make ipa / ipa-staging / generate / open / test / clean
├── scripts/build-unsigned-ipa.sh  # one command → installable unsigned .ipa
├── App/                         # the SwiftUI app target (lists + sign-in)
├── ShareExtension/              # the share-sheet target (renders + saves)
├── Shared/                      # code compiled into BOTH targets
│   ├── AppConfig.swift          #   compile-time server URL, client id, App Group id
│   ├── PKCE.swift               #   S256 verifier/challenge
│   ├── OAuthService.swift       #   authorize URL + token exchange/refresh/revoke
│   ├── TokenStore.swift         #   tokens in the shared App Group
│   ├── SirenModels.swift        #   Siren ⇄ Article decoding
│   ├── ReadplaceAPI.swift       #   the Siren client (list/save/update-status/session)
│   ├── URLDetection.swift       #   first http(s) URL in shared text
│   ├── HTMLCaptor.swift         #   WKWebView → document.documentElement.outerHTML
│   └── SaveSharedPage.swift     #   share-save orchestration (testable, no UIKit)
└── Tests/                       # XCTest unit + journey tests (URLProtocol-stubbed network)
```

The `.xcodeproj` is generated from `project.yml` by
[XcodeGen](https://github.com/yonaskolb/XcodeGen). It's committed for
convenience; regenerate anytime with `make generate` (`brew install xcodegen`).

---

## One command → installable unsigned build

From a Mac with Xcode's command-line tools and `brew install xcodegen`:

```sh
cd projects/ios-readplace
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

For a build that targets the deployed **staging** stack instead of production,
run `make ipa-staging` (or `nx run ios-readplace:compile-dev`). It sets the
`STAGING` Swift compilation condition and writes a separate
`build/Readplace-staging-unsigned.ipa`, so a tester signs in against staging
without typing a URL. Same bundle id, so it replaces the prod app on a device.

Run the tests with `make test` (boots a simulator); it also recompiles the
`STAGING` condition as a smoke pass — run that alone with `make test-staging`.

---

## Alternative: build & run from Xcode (dev signing)

You need a Mac with **Xcode 15+** and an Apple ID (a free personal team is fine).

1. **Open the project**
   ```sh
   cd projects/ios-readplace
   make open          # or: open Readplace.xcodeproj
   ```

2. **Set a unique bundle id + your team** (both targets). Bundle ids are globally
   unique on Apple's side, so the project's `com.readplace` bundle id will
   likely need changing:
   - Select the **Readplace** target → **Signing & Capabilities** → set
     **Team** to your Apple ID and change the **Bundle Identifier** to something
     unique, e.g. `com.<you>.readplace`.
   - Select the **ShareExtension** target and do the same, keeping it a child of
     the app id, e.g. `com.<you>.readplace.ShareExtension`.

3. **Confirm the App Group** (both targets share one). Under **Signing &
   Capabilities** both targets list an **App Groups** entry
   `group.com.readplace`. Keep them identical on both targets. If
   Xcode flags it, click to register it (App Groups work with a free personal
   team). If you change the id, also update `AppConfig.appGroupId` in
   `Shared/AppConfig.swift` to match.

4. **Plug in your iPhone**, select it as the run destination, and press **Run**.
   The first time, approve the developer certificate on the phone under
   *Settings → General → VPN & Device Management*.

5. **Login** in the app (the build targets `https://readplace.com`).

6. **Save by sharing**: in Safari (or anywhere with a link), tap **Share → 
   Readplace**. The extension renders the page and saves it; pull-to-refresh in
   the app to see it appear.

> Free personal teams give a 7-day provisioning profile, so the app stops
> launching after a week until you re-run it from Xcode. That's expected with a
> free personal team.

---

## Tests

`make test` (or `Cmd+U` in Xcode) runs the XCTest suite. The network is stubbed
with a `URLProtocol`, so tests exercise the real client logic — headers, bodies,
redirects, retries — without a server. Coverage focuses on boundaries and edge
cases:

- **Siren decoding**: rich vs. minimal entities, JSON `null` image/`readAt`,
  read-state from `status`/`readAt`, title fallback to URL, entities without
  properties dropped, a link/action advertised without an href tolerated and left
  unactionable, empty collections, `next`/`prev` pagination, collection warnings,
  ISO-8601 dates with/without fractional seconds, error bodies with and without a
  fallback action.
- **Href resolution**: scheme-less hrefs resolved against the origin, `http(s)`
  and the app's own deep-link scheme passed through, any other scheme treated as
  absent.
- **PKCE**: the RFC 7636 verifier→challenge vector, verifier length/alphabet,
  URL-safe challenge, uniqueness.
- **OAuth**: authorize-URL parameters, code exchange body + token storage,
  refresh keeping vs. replacing the refresh token, failure paths, revoke clears
  tokens.
- **API**: entry-point `303` redirect with the `Authorization` header preserved,
  `401` → single refresh → retry (and no retry loop when refresh fails),
  `save-content` multipart body + fallback to URL-only on an error action,
  the external content fetch never leaking the bearer token, `save-article`,
  the status action posting the urlencoded `status` field, following the `303`
  back to the collection and verifying the status at the protocol level only (any
  non-2xx/3xx surfaces a generic server error — no per-code special-casing),
  `bootstrapSession` reading the session cookie from the store URLSession parsed
  (refreshing the bearer once if expired) while keeping the minted `hutch_sid`
  out of the process-wide shared cookie jar, and missing-token handling.
- **TokenStore / URL detection**: persistence and partial-token edge cases;
  http(s)-only link extraction that ignores `mailto:`/`tel:`.
- **Login & share-save journeys**: the two orchestration seams end-to-end through
  the real session/API types. Sign-in — `completeSignIn` exchanging the code and
  flipping the session to logged-in (and rejecting a state-mismatched callback
  without exchanging the code), then a reading-list load preserving the bearer
  token across the entry-point `303`, and both sign-out paths (`logout` /
  `forceLogout`) dropping the minted `hutch_sid` session cookie.
  Share-save — `SaveSharedPage` saving rendered HTML via `save-content`, saving a
  shared PDF's fetched bytes as `application/pdf`, uploading share-sheet-delivered
  PDF bytes without rendering or refetching (and rejecting delivered bytes missing
  the `%PDF-` magic header), degrading to URL-only when the
  capture is empty, the PDF fetch is blocked, or the server refuses the payload
  with a fallback action, short-circuiting before any network call when logged out
  or when there's no link (even when PDF bytes were delivered), and reporting
  no-op when the server advertises no save
  action; plus the `HTMLCaptor` navigation-response decision (render HTML vs.
  capture a main-frame PDF as a file) in isolation.
- **Web-auth flow (shared by Login & Sign up)**: the native authorize requests
  (`readplace://oauth-callback` redirect + `screen_hint=login`/`signup`), the
  deep-link callback exchanging the code with the native `redirect_uri` and
  flipping the session logged-in, the Chrome-first open (unconditional rewrite to
  `googlechromes://`, opening Chrome, with the default-browser fallback taken only
  when the system reports Chrome can't be opened), the core handing the raw https
  authorize URL to its open seam, the `PendingAuthStore` save/load/clear
  round-trip, and the flow persisting the PKCE secrets before opening the browser
  (so a kill mid-hop can't lose them).

`make test` then runs a **staging smoke pass** (`make test-staging`): it
recompiles the app, extension and tests with the `STAGING` condition and runs
`AppConfigTests` under it. The full suite can't run under `STAGING` — the OAuth
and login/sign-up tests pin the production authorize host — but compiling everything proves the
staging build stays green, and the smoke test asserts the `#if STAGING` server
selection resolves to the staging stack. CI runs `make test`, so this path is
exercised on every run, not only when someone builds `make ipa-staging` by hand.

## Notes & caveats

- **App icon.** The app ships a brand icon — a navy serif ampersand with the
  warm-amber marker dot (see [BRAND_GUIDELINES.md](../../BRAND_GUIDELINES.md)) — in
  an `Assets.xcassets` catalog, regenerated from the brand geometry by
  `scripts/make-appicon.sh`. Compiling the catalog (`actool`) needs the iOS
  **platform/simulator runtime** installed (`xcodebuild -downloadPlatform iOS`),
  the same prerequisite as device archiving; on a partial Xcode with only the
  device SDK the build fails at `actool` until the platform is installed.
- **Login brand mark.** The logged-out `LoginView` shows the same mark — the
  serif ampersand and amber dot — above the title, as the `BrandMark` image set in
  the asset catalog. It has light (navy ampersand) and dark (white ampersand)
  variants so it stays legible on both login backgrounds, rendered from the brand
  geometry by `scripts/make-brandmark.sh`.
- **Builds from the repo's devbox shell.** `build-unsigned-ipa.sh` scrubs the
  nix toolchain env (`CC`/`CXX`/`LD`/`SDKROOT`/…) and points at the real Xcode,
  and builds the app target with `-target` (not `-scheme`) so it links against
  the `iphoneos` SDK without needing the iOS *platform* registered for a
  destination. Verified building against Xcode 15.4 (iOS 17.5 SDK).

- **Tapping an item** opens the server's authenticated reader in an in-app
  `WKWebView`. The sheet opens immediately on a skeleton; the app mints a browser
  session cookie from its bearer token and injects it into the web view before the
  first navigation, so the reader and its in-reader XHRs are authenticated.
  **This needs the server change deployed first** — see "Server dependency" below.
- **Server dependency / deploy ordering.** The swipe-to-mark-read and in-app
  reader both rely on two additive server surfaces — the entity-level
  `update-status` action and `POST /auth/session` — that must be **deployed
  before** this build ships to TestFlight. They are additive and non-breaking, so
  the server can deploy independently; an older app simply wouldn't see them.
- **Both Login and Sign up authenticate as the app's own `ios-app` client.** The
  external-browser flow can't observe an HTTPS redirect in another app's tab, so
  it returns via a native `readplace://oauth-callback` deep link, registered on
  the `ios-app` client; `/oauth/authorize` accepts an optional `screen_hint`
  (`login`/`signup`). Adding the `ios-app` client is additive, but switching the
  app onto it is a one-time breaking change for existing installs: earlier builds
  authenticated as `hutch-chrome-extension`, and `readplace://oauth-callback` has
  been removed from that client so the deep link belongs to `ios-app` alone. A
  refresh token minted under the old client is rejected once the app sends
  `client_id=ios-app`, so each existing install must sign in again once (the live
  access token keeps working until it expires, so the forced re-login is deferred,
  not immediate). Deploy the server with the `ios-app` client before the build
  that uses it — an older build still sending `hutch-chrome-extension` +
  `readplace://oauth-callback` can no longer start a login. This one-time
  re-login was a bounded cost while the app shipped only via TestFlight /
  sideload, where the tester pool turns over quickly. Once it is on the App
  Store, users stay on old builds for a long time, so a change like this — one
  that invalidates existing installs' credentials — is no longer safe to make
  unilaterally: future server-side auth changes must stay backward-compatible
  with shipped App Store builds. The native scheme is identical across
  production and staging, so sign-in needs no per-environment callback
  registration.
- **The server URL is fixed at build time** in `AppConfig.serverBaseURL` — there
  is no Server field on the sign-in screen. `make ipa` targets production;
  `make ipa-staging` compiles with the `STAGING` condition to target staging.
  Sign-in returns through the native `readplace://oauth-callback` deep link
  (`AppConfig.nativeCallbackURL`), registered for `ios-app` in
  `built-in-clients.ts` and identical across production and staging.
