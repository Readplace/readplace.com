## Every CTA Carries Its Own UTM

There is no third-party analytics on this product. A click that carries no UTM is
a click that was never recorded — there is no other place to recover it from — so
every CTA pointing at our own origin is tagged at the point it is built.

**What must be tagged.** Every `<a href>` and every `<form action>` whose
destination is our own origin and whose purpose is to move a reader somewhere or
convert them: buttons, nav and tab links, card actions, empty-state links,
onboarding steps, email CTAs, and links to our own pages from body copy on a
marketing or legal page.

**The three params.** `utm_source` is the *section* the element lives in
(`header-nav`, `footer`, `queue-card`, `home-hero`, `onboarding`, …) —
kebab-case, and specific enough that two sections of the same page are told
apart. `utm_content` is the *element*, unique within that source and named for
what pressing it does (`install`, `see-inbox-address`, `new-readlist`), never for
where it happens to sit. `utm_medium` is fixed for in-site clicks and is stamped
for you. Reuse an existing source when a CTA genuinely belongs to that section —
grep the templates for the tracking helper's `source='` argument
(`git grep -F "source='" -- '*.html' '*.template.ts' ':!*.test.*' ':!.claude'`) and
read the `source` field in the TypeScript callers of the tagging function to see
the vocabulary in use.

**How to stamp it.** Never hand-write the query string. In a template use the
tracking Handlebars helper (the registration in the shared renderer that asserts
its `source=` and `content=` named args before stamping); in TypeScript call the
shared tagging function it wraps — the function that helper's `registerHelper`
call delegates to — and import it from where that registration imports it.
Both are idempotent and both leave a non-root-relative href untouched.

**GET and POST need the params in different places**, and getting this wrong is
the failure that looks tracked and reports nothing:

| Element | Where the UTM must live | Why |
|---|---|---|
| `<a href>` | the href's query | the browser sends the href as-is |
| `<form method="POST">` | the **action's query** | its fields go in the request body, and the analytics middleware reads the query |
| `<form method="GET">` | **hidden inputs** | the submit *replaces* the action's query with the serialized fields |

A form that mixes both — an action query for POST plus hidden inputs for GET — is
correct and is what the site chrome's nav does, because one template shape serves
both methods.

**Deliberately untagged, in every case because our analytics cannot see the
click:** a destination on someone else's origin (an app store, a source
repository, a saved article's own URL) — tagging it leaks our params to another
site and records nothing; `mailto:` and `tel:`; a fragment-only href; a custom
scheme a native app intercepts; and the third-party HTML inside a saved article's
reader body. A CTA that a publisher pastes onto their own site is attributed by
its own surface marker instead, not by an in-site medium it did not come from.

A **link in a blog post's own prose is not exempt** — it is a click like any
other, and the whole reason to tag it is to learn which post sent the reader and
where they went. Its `utm_source` names the post, so no two posts share one, and
its `utm_content` names the destination: the page for a product link, the target
slug for a link to a sibling post, the cited host for a reader link. Both come
out of the markdown link itself, so a new post tags its links the same way
without a decision to make.

**This is enforced, not remembered.** Each deployable that serves pages has a
route test that renders its surfaces and asserts no same-origin CTA is missing
`utm_source` — grep the shared web test harness's non-test sources for
`utm_source` to find the checker, then grep the route tests for the function it
exports to find each deployable's test. The blog's test enumerates every
published post, so a post shipping an untagged link fails the build. A new page belongs in that test's
path list. When it fails, it names the element and the destination: tag the CTA
rather than widening the skip list.
