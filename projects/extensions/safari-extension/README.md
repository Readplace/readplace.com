# Safari Extension (POC)

A proof-of-concept Safari Web Extension for Readplace that behaves like the
[Chrome](../chrome-extension) and [Firefox](../firefox-extension) extensions and
reuses the shared [`browser-extension-core`](../../browser-extension-core)
package for all of its logic.

Safari Web Extensions speak the same WebExtension APIs as Chrome and Firefox, so
this project is a thin browser shell — the popup, background, and content scripts
are bundled from `browser-extension-core` exactly the way the other two
extensions are. The only Safari-specific, non-portable piece is wrapping the
built bundle into a macOS/iOS app with Xcode (see [Packaging](#packaging-macos)).

## What it does

Same one-click save flow as the other extensions:

- **Sign in** with OAuth 2.0 + PKCE (`initOAuthAuth` from core).
- **Save the current tab** from the toolbar popup or the right-click menu —
  capturing the rendered HTML via a content script and falling back to a
  URL-only save, through the shared `BrowserExtensionCore` pipeline.
- **List / filter / paginate / delete** your reading list by walking the Siren
  API (`initSirenReadingList` from core).
- **Cmd+D** on any page opens the popup and saves (shared `installShortcuts`).
- The toolbar icon tints green for pages already in your list.

## What is reused vs. Safari-specific

Everything substantive comes from `browser-extension-core`. This project only
provides the per-browser shell:

| Reused from `browser-extension-core` | Safari shell (this project) |
|--------------------------------------|------------------------------|
| OAuth + PKCE, token refresh          | `manifest.json` (MV2)        |
| Siren reading-list client            | `runtime/background/*.browser.ts` glue |
| Popup rendering helpers (filter, paginate, avatar, relative-time) | `runtime/popup/popup.browser.ts` glue |
| `installShortcuts` / `isCmdD`        | `runtime/content/shortcut.browser.ts` glue |
| `popup.styles.css`, popup markup     | `runtime/browser.d.ts` (API typings) |
| `initBuildExtension` (esbuild build) | `scripts/build-extension.js` wiring |

The shell mirrors the **Firefox** extension (Manifest V2, native `browser`
namespace, `browser_action`, `OffscreenCanvas` icon tinting in the background
page) rather than Chrome, because Safari does not implement Chrome's MV3
`offscreen` API. Context menus use the Chrome-style `initCreateContextMenus`
(with `removeAll()` de-duplication) because Safari's `"persistent": false`
background page can be unloaded and re-run, just like a Chrome MV3 service
worker — that behaviour is covered by `create-context-menus.test.ts`.

## Build

```sh
# From the repo root:
pnpm nx run safari-extension:compile        # -> dist-extension-compiled/ (+ a .zip artifact)

# Or point it at a local hutch server for development:
pnpm --filter safari-extension compile-dev  # HUTCH_SERVER_URL=http://127.0.0.1:3000
```

`dist-extension-compiled/` is a complete, loadable web extension (manifest +
bundled JS + popup + icons).

## Packaging (macOS)

Turning the web extension into something Safari can load requires Apple's
converter, which only exists inside Xcode. **This step cannot run on Linux/CI.**

```sh
# On a Mac with Xcode installed:
pnpm --filter safari-extension compile   # produce dist-extension-compiled/
pnpm --filter safari-extension wrap      # xcrun safari-web-extension-converter -> dist-safari-app/
open dist-safari-app/Readplace/Readplace.xcodeproj
```

In Xcode, press **Run** to build and install the host app, then enable the
extension in **Safari → Settings → Extensions**. (Allow unsigned extensions via
**Safari → Settings → Developer → Allow unsigned extensions** for local dev.)

## OAuth client

To avoid any server change, the POC reuses the already-registered
`hutch-chrome-extension` OAuth client (its `https://readplace.com/oauth/callback`
redirect is shared by all extensions). This matches the iOS POC, which reuses the
same public client. A production Safari extension would register its own
`hutch-safari-extension` client in
[`oauth-clients.ts`](../../../src/packages/test-fixtures/src/providers/oauth/oauth-clients.ts).

## Runtime requirements & caveats

- **Safari 16.4+** (uses `storage.session` for popup hand-off, added in 16.4).
- `browserAction.openPopup()` (used by the Cmd+D / context-menu paths) has
  limited support across Safari versions; the toolbar-button popup always works.
- These are runtime concerns of the shell, which — like the Chrome/Firefox
  shells — is verified end-to-end rather than by unit tests.

## Scope (what's intentionally not here)

This is a POC, so unlike the Chrome/Firefox extensions it has **no** Pulumi
infra, no auto-update hosting, and no store-publishing workflow. Its
`pnpm check` runs lint + unit tests + 100% coverage on Linux CI. The Safari
end-to-end (Selenium/`safaridriver`) flow needs a macOS host and is run manually
during development — it is deliberately kept out of the CI `check` path.
