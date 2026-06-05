# TestFlight via fastlane (CLI-only, no Xcode GUI)

Build, sign, and upload the Readplace POC (app **and** its share extension) to
TestFlight for **internal** testers, entirely from the terminal. fastlane drives
`xcodebuild` under the hood; the Xcode GUI is never opened.

## The command

```sh
cd experiments/ios-readplace-poc
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
cd experiments/ios-readplace-poc
/opt/homebrew/opt/ruby/bin/bundle config set --local path vendor/bundle
/opt/homebrew/opt/ruby/bin/bundle install

# The iOS *platform support* (separate from the SDK) is required to archive.
# Install it from the CLI (no GUI). ~7.3 GB download + install; needs ~15 GB free:
xcodebuild -downloadPlatform iOS
```

> Verify the platform installed: `xcodebuild -showdestinations -project ReadplacePOC.xcodeproj -scheme ReadplacePOC`
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
