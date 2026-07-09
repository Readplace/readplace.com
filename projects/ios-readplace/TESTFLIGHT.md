# TestFlight via fastlane (CLI-only, no Xcode GUI)

Build, sign, and upload Readplace (app **and** its share extension) to
TestFlight for **internal** testers, entirely from the terminal. fastlane drives
`xcodebuild` under the hood; the Xcode GUI is never opened.

## The command

```sh
cd projects/ios-readplace
./scripts/fastlane.sh beta
```

`scripts/fastlane.sh` runs `bundle exec fastlane beta` with the repo's nix/devbox
toolchain scrubbed and `DEVELOPER_DIR` pointed at the real Xcode (the devbox shell
otherwise hijacks the linker and breaks device archiving).

The `beta` lane is **re-runnable end to end**: regenerate project → certs/profiles
(match) → manual signing for both targets → build App Store `.ipa` → upload to
TestFlight (internal only; no external distribution, no beta-review submission).

## What you must provide

### 1. Secrets — `fastlane/.env` (gitignored)

```sh
cp fastlane/.env.example fastlane/.env   # then fill it in
```

| Key | What | Where to get it |
|-----|------|-----------------|
| `ASC_KEY_ID` | App Store Connect API key ID | App Store Connect → Users and Access → Integrations → App Store Connect API |
| `ASC_ISSUER_ID` | Issuer ID (UUID) | Same page, above the key list |
| `ASC_KEY_PATH` | Path to the `.p8` private key | Downloaded once when you create the key |
| `TEAM_ID` | 10-char Apple Developer Team ID | developer.apple.com → Membership |
| `MATCH_GIT_URL` | Private git repo for encrypted certs/profiles | A repo you create (can be empty) |
| `MATCH_PASSWORD` | Passphrase match uses to encrypt that repo | You choose it |

Authentication is **API-key only** — no Apple ID login, no app-specific password.
The API key needs the **Admin** or **App Manager** role so match can create the
distribution certificate and profiles.

### 2. The `.p8` key file

Put it where `ASC_KEY_PATH` points (default `fastlane/secrets/AuthKey.p8`):

```sh
mkdir -p fastlane/secrets
cp ~/Downloads/AuthKey_XXXXXXXXXX.p8 fastlane/secrets/AuthKey.p8
```

`fastlane/secrets/`, `fastlane/.env`, and all `*.p8`/`*.cer`/`*.mobileprovision`
are gitignored.

### 3. A private git repo for match

Create an empty private repo (e.g. `git@github.com:<you>/readplace-certs.git`),
set `MATCH_GIT_URL` to it, and make sure this Mac can push to it (SSH key or token).
The first `beta` run populates it with the encrypted cert + profiles.

## One-time machine setup

```sh
# fastlane match encrypts certs with OpenSSL. macOS system Ruby links LibreSSL
# and fails ("couldn't set additional authenticated data"), so use the Homebrew
# Ruby (OpenSSL 3) — scripts/fastlane.sh expects it at /opt/homebrew/opt/ruby.
brew install ruby
cd projects/ios-readplace
/opt/homebrew/opt/ruby/bin/bundle config set --local path vendor/bundle
/opt/homebrew/opt/ruby/bin/bundle install

# The iOS *platform support* (separate from the SDK) is required to archive.
# Install it from the CLI (no GUI). ~7.3 GB download + install; needs ~15 GB free:
xcodebuild -downloadPlatform iOS
```

> Verify the platform installed: `xcodebuild -showdestinations -project Readplace.xcodeproj -scheme Readplace`
> must list **Any iOS Device** without an "iOS … is not installed" error. Until it
> does, `build_app` cannot archive.

> **⚠️ Upload SDK gate.** App Store Connect rejects any build made with an SDK
> older than the current minimum (a 409 "SDK version issue" at `upload_to_testflight`).
> As of this writing that minimum is the **iOS 26 SDK (Xcode 26+)**. Archiving and
> signing succeed on older Xcode and produce a valid `.ipa`, but the *upload* will
> fail unless the active Xcode is current. Xcode 26 needs macOS 15+ (Sequoia/Tahoe).
> `scripts/fastlane.sh` auto-selects `/Applications/Xcode.app`; make that the new
> Xcode (or export `DEVELOPER_DIR`) so the build uses the required SDK. Because the
> cert/profiles live in the match repo, you can also run `./scripts/fastlane.sh beta`
> unchanged on any other Mac (or CI) that already has Xcode 26.

## Steps that MUST be done by a human in the Apple web portals

The App Store Connect **API key cannot** create App Group identifiers, assign
capabilities to App IDs, or create the app record. Do these once at
[developer.apple.com](https://developer.apple.com/account/resources) and
[appstoreconnect.apple.com](https://appstoreconnect.apple.com) **before** the
first `beta` run, in this order:

1. **App Group** → Identifiers → App Groups → register `group.com.readplace`.
2. **App ID** `com.readplace` → register it → enable the **App Groups**
   capability → assign it to `group.com.readplace`.
3. **App ID** `com.readplace.ShareExtension` → same: register, enable
   App Groups, assign the same group.
4. **App Store Connect app record** → My Apps → **+** → New App, bundle id
   `com.readplace`, pick an SKU + primary language. (TestFlight upload
   requires the app to exist.)
5. **App Store Connect API key** → create one with **Admin** or **App Manager**
   role; download the `.p8` (one chance only).

If App Groups are not enabled/assigned on both App IDs first, match's profiles
won't include the app-group entitlement and signing/upload will fail.

### App icon — included

The app now carries a brand `AppIcon` asset catalog (navy serif ampersand + amber
marker dot) with a 1024×1024 marketing icon, regenerated by
`scripts/make-appicon.sh`. `actool` downsamples every device size from it. Note
that compiling the catalog needs the iOS platform/simulator runtime installed
(`xcodebuild -downloadPlatform iOS`) — the same prerequisite as archiving — so the
icon and the build come online together.

## Distributing a build to a beta tester

Once `./scripts/fastlane.sh beta` has uploaded a build (built with **Xcode 26+** —
see the upload SDK gate above) and it has finished **Processing**, hand it to a
tester. The single build carries both the app and `com.readplace.ShareExtension`.

**Recommended — one INTERNAL tester (no review):** internal testers need no Beta
App Review, so the build is installable the moment processing finishes (and the
lane already uploads internal-only).

1. **Users and Access → People → +** — add the tester's Apple Account email with
   role **Developer** (or Admin/App Manager/Marketing/Account Holder). The invite
   expires in 3 days; they must accept before they appear in the tester picker.
2. **Apps → Readplace → TestFlight → + next to "Internal Testing"** — create a
   group; optionally tick **Enable automatic distribution** so future uploads
   auto-attach (otherwise click **Add Builds** after each upload).
3. Group → **Invite Testers** → select the tester. Group → **Add Builds** → pick
   the processed build → fill **What to Test** → **Add**.
4. Up to 100 internal testers; managing them needs Account Holder/Admin/App Manager.

**Alternative — EXTERNAL tester / public link** (up to 10,000): needs **Test
Information** (Beta App Description + Feedback Email, plus a demo account if login
is required) and the **first build of a version must pass Beta App Review** (~24h).
Create the external group under **TestFlight**, add the build, invite by email.

**What the tester does:** install the **TestFlight** app → accept the invite (or
redeem the link) → **Install** Readplace → **open it once** (iOS won't register the
Share Extension until the host app has launched) → in Safari, **Share → Readplace**
saves the page. Builds expire **90 days** after upload; push a fresh build to renew.

## Publishing from CI (GitHub Actions)

`.github/workflows/publish-ios-testflight.yml` runs the same `beta` lane on a
**macOS runner with Xcode 26**, so you can ship without upgrading your Mac. Like
the chrome/firefox publish workflows it's a reusable workflow invoked by
`ci.yml`, and it **only runs when the app's shipping code changed** —
`ci.yml` sets `ios-affected` from a path diff over
`App/`, `Shared/`, `ShareExtension/`, and `project.yml` (so test/doc/CI/fastlane
changes never ship a build). It's also runnable manually from the **Actions** tab
(`Publish iOS to TestFlight` → *Run workflow*) for the first publish.

Each run derives a single **build counter** `<N>` (latest + 1) from the most
recent `ios-readplace@v*` git tag — the legacy `ios-readplace-poc@v*` tags are
also read, so the counter continues unbroken across the project rename — and
drives **both** version numbers from it: the **build number**
(`CFBundleVersion`) is `<N>`, and the **marketing
version** (`CFBundleShortVersionString`) is `<major.minor>.<N>`, where
`<major.minor>` is read from `MARKETING_VERSION` in `project.yml`. So with the
spec at `1.0`, TestFlight shows e.g. `1.0.47 (47)`, then `1.0.48 (48)`. The run
**tags the commit `ios-readplace@v<N>` to reserve the counter before the
irreversible upload**, then builds and uploads. Runs are serialized (a
`concurrency` group) so two runs can't claim the same counter.

Bump the **minor** (e.g. to `1.1`) by editing `MARKETING_VERSION` in
`project.yml` in a normal PR. The **patch is the monotonic build counter and
never resets** (`CFBundleVersion` must always increase), so a later minor bump
yields `1.1.<current counter>` (e.g. `1.1.49`), not `1.1.0` — a per-minor patch
reset would need a different counter design.

### Required repository/`prod`-environment secrets

| Secret | Value |
|--------|-------|
| `ASC_KEY_ID` | App Store Connect API key id |
| `ASC_ISSUER_ID` | Issuer id (UUID) |
| `ASC_KEY_P8_BASE64` | The `.p8`, base64-encoded: `base64 -i AuthKey.p8 \| pbcopy` |
| `ASC_TEAM_ID` | 10-char Developer Team id |
| `MATCH_GIT_URL` | match repo URL — use the **HTTPS** form for CI |
| `MATCH_PASSWORD` | match encryption passphrase |
| `MATCH_GIT_BASIC_AUTHORIZATION` | base64 of `<user>:<PAT>` granting read access to the match repo |
| `TAG_PUSH_TOKEN` | fine-grained PAT (`Contents: read/write`) to push the version tag |

Until these are set the workflow **skips cleanly** (no red run). Once set, every
push that changes the app's shipping code builds and uploads a new internal
TestFlight build automatically.

## Releasing to the App Store

TestFlight ships automatically (above); a full App Store release adds the
listing and a deliberate human submission. The moving parts:

1. **Listing metadata** lives in `fastlane/metadata/` — including the App
   Review notes (`review_information/notes.txt`) and the primary category. The
   `release` lane pushes it to App Store Connect as a **draft**: run
   `bundle exec fastlane release` locally (same `fastlane/.env` as `beta`) or
   trigger **Publish iOS App Store metadata** from the Actions tab (same `prod`
   environment secrets; no Mac needed). It requires an App Store version in
   *Prepare for Submission* and never uploads a binary or submits for review.
2. **Screenshots** live under `fastlane/screenshots/en-US/` (iPhone 6.9″-slot
   sizes: 1320×2868 or 1290×2796; the app is iPhone-only so no iPad set).
   Push them with `bundle exec fastlane release screenshots:true` (or tick the
   checkbox on the Actions run) — `overwrite_screenshots` replaces whatever is
   in App Store Connect.
3. **App Review contact + demo account** ride the same push, from `prod`
   environment secrets (never git — they are PII/credentials):
   `ASC_REVIEW_FIRST_NAME`, `ASC_REVIEW_LAST_NAME`, `ASC_REVIEW_EMAIL`,
   `ASC_REVIEW_PHONE` (format `+<country> <number>`), and optionally
   `ASC_REVIEW_DEMO_USER` / `ASC_REVIEW_DEMO_PASSWORD`. All four contact
   fields are required by App Store Connect to *create* the review detail;
   until they exist (as secrets, or entered once by hand in ASC), a push that
   includes review notes fails with "missing a required attribute
   contactFirstName".
4. **Manual, in App Store Connect** (the release lane deliberately does none of
   these): create the version in *Prepare for Submission* — its string must
   equal the attached build's `<major.minor>.<build>`, and every iOS-shipping
   merge mints a new build, so create it right before submitting; attach the
   build; complete the **App Privacy** labels (keep them consistent with
   `Shared/PrivacyInfo.xcprivacy`: email address, user ID, browsing history —
   all linked, none tracking), **age rating**, and **pricing & availability**;
   answer the content-rights question (the reader displays user-saved
   third-party articles); choose the release option; **Submit for Review**.
5. **After approval**: point the iPhone client's install URL
   (`src/packages/supported-clients/src/supported-clients.ts`) at the App
   Store listing instead of the TestFlight join link, and update the iPhone
   blog post's beta framing.
