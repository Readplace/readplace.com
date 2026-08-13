---
name: blog-post-editor
description: Blog post authoring conventions. Use when creating, editing, moving, or troubleshooting blog posts. Triggers on blog content work, markdown files intended for the blog, or questions about the /blog route.
---

# Blog Post Editor

## Finding the Posts Directory

The blog discovery module scans a directory at runtime using `readdirSync` and filters for `.md` files. To find the current posts directory:

1. Grep the codebase for the file that calls `readdirSync` and filters `.md` blog files (e.g. `readdirSync.*\.md`)
2. In that file, find the variable that resolves the posts directory path (e.g. a `join(__dirname, ...)` call)
3. The resolved directory is where blog post markdown files must be placed

Do not assume a hardcoded path. Always discover it from the source code.

## Blog Post File Requirements

Each post is a single markdown file placed in the discovered posts directory.


### Frontmatter Schema

Every post must have YAML frontmatter with the fields that follow the pattern of existing posts

### Slug-Filename Invariant

The `slug` value in frontmatter **must** match the filename (minus `.md`). For example, a file named `my-post.md` must have `slug: "my-post"`. The discovery module asserts this at load time and will throw if they diverge.

## Highlighting features (changelog banner)

To surface a shipped feature to every user on every page (guests included), tag the announcing post and give it banner copy:

```yaml
tags: [changelog]
banner: I added keyboard shortcuts to the reader
```

- The **newest** post tagged `changelog` drives a site-wide banner (a "NEW" chip, the `banner:` hook, and a "Read more" link to the post). It shows on the app and on `/blog`.
- A post tagged `changelog` **must** include a `banner:` line — the loader rejects it otherwise.
- The banner stays dismissed (per reader) until the copy changes; editing `banner:` or publishing a newer changelog post makes it reappear.

Both `tags` (a string array, defaults to `[]`) and `banner` (a string) are optional frontmatter fields; only changelog posts need them.

### Banner copy rules

The banner is a conversion surface, so the copy is deliberate:

- **Concise hook with a curiosity gap.** State *what* changed; let the click reveal *how*. ("I added keyboard shortcuts to the reader" — not "Keyboard shortcuts: press j/k to move, x to archive…".)
- **Let the NEW chip carry the novelty.** Don't write "New:" or "Just shipped" in the hook.
- **Brand voice.** No emoji, no exclamation marks, no superlatives. Talk like a person.

## Figures (`rp-figure`)

A post draws a chart or an interactive widget by writing a fenced `rp-figure` block. The renderer expands it to HTML at load time; the post keeps only the data. Grammar and validation live in [blog-figure.parse.ts](../../../projects/blog-site/src/runtime/web/pages/blog/blog-figure.parse.ts), the markup in [blog-figure.render.ts](../../../projects/blog-site/src/runtime/web/pages/blog/blog-figure.render.ts), the styles in [blog.styles.css](../../../projects/blog-site/src/runtime/web/pages/blog/blog.styles.css).

Read those three files for the current field lists before writing a figure — the summary below is the *why*, not the schema.

### The bar every figure has to clear

**A figure may only draw what its own post already states.** If you would have to invent a number, a duration, a price, or a behaviour to fill it, the post does not get a figure. Most posts do not get one, and that is the correct outcome — a feature announcement with no quantity and no comparison has nothing a chart carries better than the sentence.

Beyond that, a figure earns its place only by carrying one of:

- a comparison between two or more measured things,
- a magnitude the prose can only assert,
- or a rule the reader can probe, where the branches interact.

Stepping a reader through a chain they can already read whole is not one of these. Neither is re-enacting a UI the post describes.

Two rules follow from the first, and both are enforced in the parser:

- A cell whose value the post never reports renders as *not reported*. Never fill it in to make a table look complete.
- A `budget` figure carries every step's counts explicitly rather than a formula, so no step can draw arithmetic the post does not support.

### Choosing a kind

| Kind | Use it for | Reader does |
|---|---|---|
| `bars` | Independent before/after measures of one change. Each row is scaled to its own larger value and prints both numbers, because the rows share no unit. | Nothing — this one is a picture |
| `walk` | A chain whose stages can refuse or degrade the payload, where the interesting claim is *where it falls back to*. | Picks a stage, flips its guardrail to failing |
| `matrix` | Implementations × rules, where a fix collapses disagreeing columns into one answer. | Flips one before/after switch |
| `budget` | One quantity feeding two counters that separate as it climbs. | Picks a value on a stepped track |
| `rule` | A shipped rule with two or more inputs that interact, answering with a verdict and the clause that decided it. | Sets the conditions |

There is no line chart and no series kind. A post with more than two points in a sequence keeps its prose.

### No client JavaScript

blog-site ships no client bundle, and no figure may introduce one. Every interactive kind runs on native radio and checkbox inputs plus `:has()`, which is why keyboard and screen-reader behaviour come for free and why nothing here is subject to a jsdom-only test.

The `:has()` rules sit inside `@supports`, so each kind also has to read without them. That fallback is a design constraint, not a leftover: `walk` opens on its first stage, `matrix` shows the before column, `budget` shows its last step, `rule` shows the `else` branch. Each is an honest state on its own.

Two consequences for authors:

- The **first** option of a `choice` and the **last** `step` of a `budget` are what the figure loads with. Order them so the state it opens in is the one the post argues about.
- The selector lists in the stylesheet enumerate positions, so each kind has a ceiling (`MAX_WHENS`, `MAX_STEPS` in the parser). Raising one means extending the matching selector list.

### Colour

One meaning, across all five kinds: **brand amber is the behaviour that ships today** — the selected stage, the new rule, the cell the fix moved. Muted grey is the shape it replaced. `--color-error` is only ever a failure. Amber never marks a wrong count.

Never hardcode a hex. The figure stylesheet is entirely token-driven so both themes come out right; a literal `#c8702a` renders light-mode amber on a dark page.

### Placing one

Put the figure directly after the paragraph it illustrates, with a blank line either side. Never inside the `<details class="blog-tldr">` block, and never before the first `##` heading. A post may carry more than one figure; input ids are numbered per post, so two figures never collide.

## Ordering

Posts are sorted by `date` in descending order (newest first) automatically by the discovery module. No manual ordering is needed — just set the correct `date` in frontmatter.

## Testing

Do not create new tests when adding or removing blog posts. The existing tests validate the blog infrastructure (discovery, rendering, SEO) and are written to work regardless of which posts exist.

If adding or removing a post breaks any test, rewrite the broken test so it no longer couples to a specific post. Tests should derive their expectations dynamically from the loaded posts (e.g. use `getAllPosts()[0]` or `getAllSlugs()`) rather than hardcoding a slug, title, or date.

## Verification

After adding or moving a blog post:

1. Run the project's test suite to confirm the post is discovered and parsed without errors
2. Check that `getAllPosts()` returns the new post alongside existing ones
3. Confirm the post is accessible at `/blog/{slug}`

A malformed `rp-figure` throws while the posts load, so it surfaces as a failure of the existing "every post loads" test rather than at a Lambda cold start. If you added one, also open the post and operate it — with a real click, not by setting `.checked` from the console, which does not always trigger the `:has()` invalidation a user event does.
