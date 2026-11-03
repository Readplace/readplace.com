## Server-Side Rendering with Progressive Enhancement

This project uses an SSR-first approach. Core principles:

### URL as State

The URL query string represents the complete page state. All user interactions that modify state should be expressible as URL changes via HTML `<form>`.

Not every query parameter is state. Some only pick a representation — a feature toggle, a `swap=card` marker, a poll counter — and those are read where they are used, never parsed into the page's state type and never added to a shared link builder. A parameter in the builder rides every link the page emits, so it spreads across the codebase on the way in and has to be unpicked from every caller on the way out.

A GET form that edits one part of the state — a search box — carries the rest of the URL state as hidden inputs, because its submit replaces the action's query; the state stays in the URL, never in hidden server state. Unlike a representation parameter such as `swap=card`, what such a form edits is state, so its parameters belong in the page's shared link builder and every sort, tab and page link keeps them.

State the reader expects to outlive the link — the readlist's filter chips, which stay on for the signed-in session — is still named in the URL, and is also remembered server-side. Remembering is a write, so the form that edits it is a POST that answers 303 to the link naming the new state (see [No Side Effects on GET](#no-side-effects-on-get)); a GET only reads the remembered value, and only for a link that names none of its own. Such a form carries the rest of the URL state in its action's query, where a POST keeps it.

### View Model Pattern

Transform query string parameters into a structured view model before rendering. Templates should be "dumb" - they render what the view model provides without business logic.

### Progressive Enhancement

Build features in two steps:

**Step 1 — Semantic HTML first.** Every interaction must work as a standard HTML form submission or link navigation with no JavaScript. Use `<form method="POST">` for mutations and `<a href="...">` for navigation. This is the baseline that must always work.

**Step 2 — Add htmx for SPA performance.** Once the semantic HTML works, add `hx-boost="true"` to forms and link containers so htmx intercepts them as AJAX requests. Use `hx-target="main" hx-select="main" hx-swap="outerHTML show:none"` to swap only the `<main>` content without scrolling. The server returns the same full HTML response — htmx extracts just the `<main>` fragment.

```html
<!-- Step 1: Works without JS -->
<form method="POST" action="/items">
  <input type="text" name="title" required>
  <button type="submit">Create</button>
</form>

<!-- Step 2: Same form, boosted for SPA feel -->
<form method="POST" action="/items"
      hx-boost="true" hx-target="main" hx-select="main"
      hx-swap="outerHTML show:none">
  <input type="text" name="title" required>
  <button type="submit">Create</button>
</form>
```

No custom `*.client.ts` is needed when htmx covers the interaction. Reserve `*.client.ts` files for behaviour htmx cannot express (e.g., inline validation, animations).

A side drawer is a native popover, opened declaratively so it needs no script, with a `<details>` fallback holding the same form. Its CSS is legacy-first: the popover trigger is hidden by default and revealed under `@supports selector(:popover-open)`, which also hides the fallback — the same flip the rail and card fallbacks use. htmx puts its in-flight class on the `hx-indicator` targets, not on the element that sent the request, so a form that styles its own in-flight state lists `closest form` among them.

IMPORTANT: Ask for human intervention whenever a deviation from htmx is needed away from this basic pattern for SPA navigation.

**Sanctioned deviation — a dialog that refuses input in place.** No client script requests or parses JSON from the server. A dialog form whose value the server can refuse posts with `hx-post`, `hx-target="this"`, `hx-swap="outerHTML show:none"` and `hx-sync="closest [popover]:drop"`, and keeps `method` and `action` so a browser without JavaScript posts it and follows the 303. An invalid value answers 422 with the form re-rendered — the value as typed, the reason under the field, and `aria-invalid` on the field, whose `autofocus` the swap honours so focus returns to it — which the shared htmx config swaps. A valid value answers `HX-Location` as htmx's object, which htmx parses itself: `path` is where the 303 goes, `source` is the dialog's `#id`, `target` and `select` are `main`, and `swap` names where the reader lands: `outerHTML show:none scroll:html:top` when it is another listing or a page alert, and `outerHTML show:none` when it is back on the page they acted from, such as a readlist created from a card's Add or Move or from the reader's Add to readlist. Never a bare path, because that swaps `<body>`. `hx-sync` never goes on the dialog or an ancestor, because htmx would then drop the follow-up GET that `source` starts. Any other answer, such as a followed redirect to the login page, must stay out of the dialog, or a whole page lands inside it. A dialog whose field already stops every value the server refuses, such as Edit profile's `maxlength`, keeps its plain post: its 400 answers only a request built by hand. A dialog whose success ends the session, such as deleting the account, keeps a boosted form targeting `main` instead: the browser's `pattern` check refuses a wrong value before anything is sent, a refusal that still reaches the server answers 303 to the page's inline form, and success answers `HX-Redirect`, because `HX-Location` cannot follow the app's `readplace://` exit. A page form that refuses input in place, such as Change password, answers the same way: its `source` is its card's `#id`, never the form, because htmx adds a form source's fields to the follow-up GET's query, and a signed-out htmx request answers `HX-Redirect` to the login page. While the landing loads, only the source carries htmx's in-flight class, so a dialog form or a page form keys its in-flight look on that class on any ancestor and points its `hx-sync` at the source, which drops a second press. To find the examples, grep the web pages of the project that serves `/queue` for `HX-Location`: every hit is an example of this pattern, including the page script that keeps every answer but a 422 out of the dialog.

**Sanctioned deviation — card-scoped list mutations.** A mutation whose only visible effect is that one list row changes may swap the row instead of re-shipping the whole `<main>`, when re-rendering `<main>` is the measured cost. The queue's card mark-read/unread do this: the form targets the row (`hx-target` set to `closest` plus the card's block class, `hx-swap="outerHTML show:none"` — see [Every Swap Declares Where the Page Ends Up](#every-swap-declares-where-the-page-ends-up)); a `swap=card` marker on the action href — a response-representation hint the server never trusts as state, consistent with the URL-as-state rule above — routes an htmx submit to a small card-removal fragment plus out-of-band toast/counts; and the **server**, never the client, decides when the DOM has drifted (page emptied, page beyond the last, the pagination controls changed, or the change didn't apply) and answers with the full listing via `HX-Retarget: main`. The no-JS, Undo, reader and API callers keep the byte-identical `<main>`/303 path, and delete and move keep their full-`<main>` confirm-popover flows. This is already decided — follow it for equivalent list-row mutations instead of re-asking. See the queue page's card status-swap handler — the one that answers with the `HX-Retarget` header when the DOM has drifted (grep for `HX-Retarget` in the web pages of the project that serves `/queue` — the single hit there is it; the repo-wide second hit is the newsletter inbox's lock-check middleware) — and the mutation-fragments module it imports, which renders the card-removal fragment plus the out-of-band toast and counts.

**Sanctioned deviation — a popup whose open state is a URL parameter.** A popup that hosts a page's whole selection form, where the reader opens it from far down the page and expects it right where they are, renders server-side whenever the URL says it is open, so a link, an email, a reload and Back/Forward all reopen it. The Gmail newsletters page (`/newsletters/gmail`) does this for its `add=1` and `edit=1` parameters; follow it for an equivalent popup instead of re-asking.

| Piece | Behaviour | Why |
|---|---|---|
| Opening | The server resolves the mode once and renders the popup closed; a page script shows it on load, after a settle and after a history restore | htmx cannot open a popover, and the URL, not a click, is the source of truth |
| History | The popup carries `hx-history="false"` | A snapshot would restore it without its opening focus, so Back refetches it |
| Forms inside | Target the popup's body, which keeps the panel and its scroll; search, polls and Load keep their own targets | Re-shipping `<main>` would close and reopen the popup on every tick |
| Foreign answers | An answer that lacks the swap target's id (Save success, a login redirect) is retargeted to `main` by the script | Otherwise a whole page lands inside the popup |
| Closing | ✕ and Cancel are boosted links to the closed URL; Escape and click-outside follow Cancel, unless a request from inside the popup is still in flight | Closing is a navigation, so the URL and history stay true; an in-flight answer must land where it was asked for |
| Success | Save answers the closed page, which swaps `main` and drops the popup; focus returns to the control that opened it | Removing an open popover fires no toggle, so there is no second navigation |
| No JavaScript or no popover | The same element renders in flow, with its autofocus, through a shared in-flow modifier of the confirm panel | Every form still posts or gets normally and lands on the page |

The popup body's `outerHTML` swap needs the same scroll-anchoring reset as `<main>` (see the next section), or the panel jumps to its bottom. Its sticky footer applies only while the popup is open, or in flow it covers the page.

### Every Swap Declares Where the Page Ends Up

Every swap has one intended scroll outcome, and the swap spec states it:

| Intent | Typical use | Write |
|---|---|---|
| Stay put | tabs, sort, pagination, row mutations, confirm dialogs, Undo | `show:none` |
| Go to the top, like a page load | moving to a different document (the next article) | `show:none scroll:html:top` — `show:none` cancels the default scroll to the swapped content, `scroll:` resets the page instantly where `show:` would animate |
| Reveal a named element | the row a save just added | `show:#<id>:top` |

Three things override the declared intent without any attribute changing, which is why three scroll bugs got past review:

| Override | Symptom | What to write |
|---|---|---|
| htmx's boost default: a boosted element with no `show:` modifier scrolls to the first element the response swaps in | the page lands on whatever came first — an out-of-band toast at the end of `<main>` sends it to the bottom | a `show:` modifier on every boosted element, row-scoped ones included |
| The response's shape: an `HX-Reswap` header replaces the element's whole swap spec, and an `HX-Retarget` or out-of-band piece changes what is swapped in first | an error or retargeted answer scrolls even though the element says `show:none` | any `HX-Reswap` restates the intent (`outerHTML show:none`); check the retargeted answer in a browser, not only the normal one |
| Browser scroll anchoring: `outerHTML` inserts the new region before removing the old one, anchoring follows the old content down by the new region's height, and the removal clamps the page to the bottom | the page lands at the bottom although `show:none` is set | nothing per element for `<main>` — the shell's reset turns anchoring off while `<main>` carries htmx's swapping class (grep the workspace packages for `overflow-anchor`; the single hit is it). A different region replaced the same way needs the same treatment |

A unit or route test that compares the `hx-swap` string proves none of this: all three overrides happen in the browser. A new swap shape — a new target, a header that changes the swap, an out-of-band piece — ships with a browser test that scrolls the control into view, clicks it with a real pointer click (one that does not auto-scroll), waits for the destination, and asserts `scrollY` once the page has stopped moving. `scrollBehavior` is smooth, so a wrong scroll has barely started at `htmx:afterSettle`; read it too early and the test passes on a page that is about to jump. The queue listing's scroll-stability suite does this — grep the E2E sources for `htmx:afterSettle` and reuse the browser helper there that waits for `scrollY` to hold still before stamping it.

```html
<!-- ❌ BAD — boosted, no show: modifier; htmx scrolls to the first swapped-in element -->
<form method="POST" action="/bookings/42/seat" hx-boost="true"
      hx-target="closest .booking-row" hx-swap="outerHTML">

<!-- ✅ GOOD — the intent is declared: the page stays where the reader is -->
<form method="POST" action="/bookings/42/seat" hx-boost="true"
      hx-target="closest .booking-row" hx-swap="outerHTML show:none">
```

### A Pending State Ends When Its Work Does

| Rule | Why |
|---|---|
| The pending state renders on the press, per the brand guidelines' [Loading States](../../../../brand-guidelines/components/loading-states.md#loading-states) | A press with no visible answer reads as a broken control and gets pressed again |
| Every poll asks the store whether the work finished — succeeded or failed — and the first poll that sees the outcome renders it | The reader waits only as long as the work does |
| A poll-count budget is a backstop for work that never reports, never the normal exit | A budget sized for the slowest case makes every fast outcome wait for it |
| When the finished state looks like the starting state (a retry that fails leaves the row as it was), every outcome write moves a monotonic marker on the row. The view that offers the action mints the marker's current value into the poll URL as a representation parameter, and later polls compare with `>` | Without a baseline the poll can't tell "not yet" from "done, and it failed again". Taking the baseline from the rendering read survives a lagging replica. Never infer done from elapsed time or poll count |
| Work that runs off the server (a device capture) tells the page when it ends without a result, through a DOM event the pending region listens for | The server can't see a device give up; only the budget would end the wait |
| For work the reader started, a spent budget renders its own outcome saying what happened — never the pending copy, never a silent return to the view the reader acted from | A revert looks as if the action was ignored |
| For work the reader started, the outcome names what happened to their own action, distinct from the copy shown before they acted | The same notice before and after reads as "nothing happened" |
| Work the page started without the reader acting (an automatic capture) ends, on a spent budget or a give-up, on the view for the stored state, with no outcome of its own. Its poll URL says which kind of work it is, and the server decides what renders | An outcome naming an action the reader never took describes something they didn't do |

**This is enforced, not remembered.** Route tests pin four things: the poll after the outcome lands renders it, a spent budget renders the overrun outcome, the device's give-up event renders at once, and both end an automatic capture on the stored state's notice. To find the worked example, grep the page templates for `readplace-capture-failed`.

### Every Popup Opens on Its First Decision

A popup that opens focused on its own container is a dead stop: the reader must click or Tab before Enter or typing does anything. The [popover focusing steps](https://html.spec.whatwg.org/multipage/popover.html#popover-focusing-steps) focus the popover itself if it carries `autofocus`, else its first `autofocus` descendant, else nothing — the same for `popovertarget` and `showPopover()` — so one attribute on the right element is the whole mechanism.

| Popup shape | Opens on | Why |
|---|---|---|
| Confirmation, destructive included | its commit control | Enter confirms; Esc still dismisses natively |
| Text dialog | the field, always — not only on a 422 | the reader came to type |
| Required radio group, nothing checked | the first option | there is no choice yet to commit |
| Choice with a pre-checked option | the submit; the inline plans page takes none | a valid answer is already in place |
| Copy the link | the Copy control once the script knows the clipboard is writable; otherwise focus stays on the trigger | a hidden control cannot take focus |
| Side drawer | the first chip of the first group, popover copy only | the drawer's work starts there |
| Edit a saved item (a URL-state popup) | its Save | the choice is already in place |
| Add items from a checklist (a URL-state popup) | the first ticked row, else the first row, else the search box with its picker rendered open | a box inside a closed `<details>` cannot take focus; a request that only refreshes the popup's body renders no autofocus |
| `<details>` picker | its script focuses the first option on toggle | `<details>` has no focusing steps |
| Tooltip popover, the unprompted balloon, `<details>` menus, switchers and header disclosures | none | no primary action; focus stays on the toggle |

| Rule | Why |
|---|---|
| One `autofocus` per popover, never on the `[popover]` element | each popover is its own autofocus scoping root, and the panel's own attribute wins over every descendant's |
| Keep `tabindex="-1"` on the panel | a click inside keeps focus inside — Safari does not focus clicked buttons |
| A template shared with an inline page or a `<details>` fallback sets the attribute from a per-surface map; the page copy never carries it on GET. The one exception is a URL-state popup's in-flow fallback, which is the same element and is only ever rendered open | a visible `autofocus` is focused on load and by htmx after every swap ([first match, no visibility check](https://github.com/bigskysoftware/htmx/blob/v2.0.8/src/htmx.js)) |
| `autofocus` inside a closed popover is inert | a closed popover's content is not rendered, so neither the page-load flush nor htmx's post-swap focus can reach it |

**This is enforced, not remembered.** The shared web test harness has a popover-focus checker — grep the harness's non-test sources for `autofocus`; the one file that matches is the checker — and the project that serves `/queue` runs it over every popover-bearing page, asserting no gap and pinning the set of dialogs it meets. A new dialog belongs in that test's path list and key list, and its browser spec asserts the focused element right after the popover opens.

### No Side Effects on GET

Never mutate state on a GET — proxies cache them, prefetchers fire them, crawlers hit them. For URLs that need to trigger a mutation (e.g., a share-able permalink), render a page with an auto-submitting `<form method="POST">`:

```html
<form method="POST" action="/items" data-submit-on-load>
  <input type="hidden" name="title" value="...">
</form>
```

Two pages already do this — grep the web pages for `querySelector('[data-auto-submit]')` and reuse that attribute and its inline script rather than inventing another.

Alternatively use the POST - Redirect - GET pattern.

### Anti-Patterns

| Avoid | Instead |
|-------|---------|
| Client-side state management (`let passengers = []`) | State in URL query string |
| Redundant JSON APIs for web UI | Use HTML responses |
| Hidden form fields for state | State in URL |
| JavaScript-only interactions with no HTML fallback | Semantic forms/links first, htmx second |
| A boosted element with no `show:` modifier, or a test that only compares the `hx-swap` string | Declare the scroll intent and prove it with a real click in a browser — see [Every Swap Declares Where the Page Ends Up](#every-swap-declares-where-the-page-ends-up) |
