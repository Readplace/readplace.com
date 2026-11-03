## Client-Side JavaScript Conventions

### Test Attributes Are for Tests Only

`data-test-*` attributes must NEVER be used in client-side JavaScript.

```javascript
// ❌ BAD
var input = section.querySelector('[data-test-field="firstName"]');

// ✅ GOOD
var input = section.querySelector('[name="firstName"]');
```

### Derive Field Names Dynamically

Never hardcode field names. Discover them from the DOM.

```javascript
// ❌ BAD - Hardcoded
params.delete('firstName');

// ✅ GOOD - Discover from DOM
form.querySelectorAll('[name]').forEach(function(el) {
  fieldNames.push(el.name);
});
```

### Re-sync Swapped-In Elements on `htmx:afterSettle`

A client that toggles a class or attribute on an element htmx swaps in must re-sync on `htmx:afterSettle`, never on `htmx:afterSwap` or `htmx:oobAfterSwap`. htmx swaps an id-matched element in wearing the outgoing element's attributes, then restores the incoming markup's own attributes — `class` among them — in a settle task that runs between those two events. So anything a client writes on the swap event is reverted a few milliseconds later, with no error to show for it. Only that element's own attributes are affected, which is why a client that writes text or reads state elsewhere sees nothing wrong.

A pipeline whose local test double settles synchronously renders the finished state at SSR and never exercises the swap path at all, so this class of bug survives a green local run and shows up only against a deployed environment.

### Browser JS Is Bundled and Served Same-Origin

Compile `*.client.ts` to a browser IIFE bundle and reference it via a relative `<script src="/...">`. Do not route the URL through the static asset base URL used for images.

**Why not inline via `Function.prototype.toString()`**: the dev TypeScript transformer wraps compiled functions with runtime helpers (e.g. `__name`) that only live at module scope. Stringifying the function body into a `<script>` tag strips it from that scope and the page throws `ReferenceError` on load.

**Why same-origin, not the CDN**: the bundle changes per commit and must ship atomically with the HTML that references it. A CDN URL lets the asset and the HTML drift out of sync — any developer who points the static base URL at a remote CDN gets a 404 (and in Chrome an ORB-blocked response) for the latest bundle until the next deploy.

```html
<!-- ❌ BAD — inline Function.toString() leaks compiler helpers -->
<script>(function () { var init = ${initThing.toString()}; init(...); })();</script>

<!-- ❌ BAD — CDN URL drifts from the HTML per commit -->
<script src="${STATIC_BASE_URL}/.../thing.client.js" defer></script>

<!-- ✅ GOOD — same-origin bundle, atomic with the HTML -->
<script src="/<bundle-prefix>/thing.client.js" defer></script>
```

The bundle output directory must be inside the runtime asset tree so the Lambda packaging step ships it alongside the handler; the Express app mounts the matching URL prefix as `express.static` so the same relative URL resolves in dev and in prod.

### Web App Manifest Is Served Same-Origin

Serve the web app manifest from the document's own origin, not the static-asset CDN: a manifest's relative URLs (`start_url`, icon `src`) resolve against the manifest's own URL, so a CDN-hosted manifest makes `start_url` cross-origin to the document and Chrome warns. A 301 from the app origin to the CDN does not fix it — relative URLs then resolve against the redirected CDN URL — so the app origin must serve the manifest body itself and stamp each icon `src` as an absolute CDN URL.

```html
<!-- ❌ BAD — CDN-hosted manifest: start_url resolves cross-origin, Chrome warns -->
<link rel="manifest" href="${STATIC_BASE_URL}/site.webmanifest">

<!-- ✅ GOOD — same-origin manifest; a builder stamps icon src values absolute to the CDN -->
<link rel="manifest" href="/site.webmanifest">
```
