---
name: blog-post-editor
description: Blog post authoring conventions, plus the writing, structure, and voice rules a post must follow. Use when creating, editing, moving, or troubleshooting blog posts. Triggers on blog content work, markdown files intended for the blog, or questions about the /blog route.
---

# Blog Post Editor

Drafting a post is the highest-effort task in this repo. Run it at maximum effort on the strongest model available. A post ships under a person's name to every reader of the product, and a draft that reads as machine output costs more than the time saved writing it.

**Precedence.** [Structural Variety](references/structure.md#structural-variety) overrides every other rule in this skill, references included. Where a voice, an opening rule, or a register figure tells you to write one way and Structural Variety caps that way, Structural Variety wins.

**Scope of the writing rules.** Everything under `references/` — [What the Post Has to Say](references/structure.md#what-the-post-has-to-say), [Structural Variety](references/structure.md#structural-variety), [Voice](references/voice.md#voice), [Writing Rules](references/writing-rules.md#writing-rules) and [Figures](references/figures.md) — governs *post prose*. It does not govern this file, `BRAND_GUIDELINES.md`, code comments, or commit messages, all of which use punctuation the post rules ban. Quoted material is also exempt: a direct quote, an error string, or a screenshotted UI label belongs to its source, so do not edit it to satisfy a rule here.

---

## Mechanics

### Finding the Posts Directory

The post loader scans a directory at runtime using `readdirSync` and filters for `.md` files. To find the current posts directory:

1. Grep the codebase for the file that calls `readdirSync` and filters `.md` blog files (e.g. `readdirSync.*\.md`)
2. In that file, find the expression that resolves the posts directory the loader reads from
3. The resolved directory is where blog post markdown files must be placed

Do not assume a hardcoded path. Always discover it from the source code.

### Blog Post File Requirements

Each post is a single markdown file placed in the discovered posts directory.

### Frontmatter Schema

The schema is a zod object in the post loader — the module that scans the posts directory, found as in [Finding the Posts Directory](#finding-the-posts-directory) — read it for the exact types. A post that violates it throws while the posts load, so a mistake here fails the whole blog, not one page.

| Field | Required | Notes |
|---|---|---|
| `title` | yes | Rendered as the post `<h1>`. Posts carry no H1 of their own — see [Post Body Format](#post-body-format). |
| `description` | yes | The field is `description`. There is no `summary` field. |
| `tldr` | yes | One markdown paragraph (inline code and links are fine). Rendered by the shared disclosure before the body; `excerpt` is its collapsed preview line. |
| `excerpt` | yes | One line, at most 100 characters (the reader's excerpt budget, enforced at load). The collapsed TL;DR preview, followed on the page by "view more …". A hook sentence written for the post, not a cut-down `description`. |
| `slug` | yes | Must equal the filename — see [Slug-Filename Invariant](#slug-filename-invariant). |
| `date` | yes | `YYYY-MM-DD`, regex-enforced. Drives ordering. |
| `author` | yes | |
| `lastModified` | no | `YYYY-MM-DD`. Set only when the text was actually revised after publication, so the rendered `dateModified` asserts something true. |
| `keywords` | no | One comma-separated string, not an array. |
| `tags` | no | String array, defaults to `[]`. |
| `banner` | no | One-line hook for the site-wide banner. |

Two cross-field rules are enforced at load:

- A post whose `tags` include `changelog` **must** carry a `banner:`. The loader rejects it otherwise.
- `lastModified` must not precede `date`.

Unknown keys are dropped rather than rejected, so a typo in an *optional* field name fails quietly — the field simply goes missing and nothing complains. A typo in a required name throws at load. Check the spelling against the table above.

### Slug-Filename Invariant

The `slug` value in frontmatter **must** match the filename (minus `.md`). For example, a file named `my-post.md` must have `slug: "my-post"`. The post loader asserts this at load time and will throw if they diverge. Slugs must also be unique across the directory, which a second assert enforces.

### Post Body Format

**No H1.** The template renders `title` as the `<h1>`. The body's own headings start at `##`. There is no subtitle element either — `description` plays that role, on the index card and in the page metadata.

**Every post opens with a TL;DR disclosure, and the body carries none of it.** The paragraph lives in the `tldr:` frontmatter field; the body holds no TL;DR HTML. The page draws the disclosure before the body from that field, collapsed, with `excerpt` as the one preview line a reader sees before opening it. The `text/markdown` representation carries the same paragraph as a `> [!summary]` callout ahead of the body.

Write `tldr:` and `excerpt:` each as one double-quoted YAML string on one line, so a colon or a `#` in the paragraph cannot end the value early. Escape a literal `"` as `\"` and a literal backslash as `\\`.

The disclosure is one component shared with the reader's article summary, so a design change lands on both. To open it, grep the non-test sources of the shared presentational shell package (`pnpm nx show projects` lists it; its description says so) for the `data-summary-toggle-url` attribute — the `<details>` template that writes it is the component.

**Citing an external article.** Link through the reader rather than off the site. Drop the `https://` scheme and append the rest to `/view/`, as a root-relative link:

```markdown
[research post about poisoning language models](/view/www.anthropic.com/research/small-samples-poison)
```

The `/view/` path builder — the function that turns an article URL into that path, in the module that percent-encodes `?` and `#` (grep TypeScript outside test files for `%2525`, the re-encoding of an already-encoded percent sign) — is the source of truth for the transformation: `https://` is dropped, `http://` is kept literally because it is the minority case, slashes stay unencoded, and `?` and `#` inside the article URL become `%3F` and `%23` so Express's query parser does not claim them. Use the relative form. One post uses an absolute `https://readplace.com/view/...` link and it is an outlier, not the convention.

**Pull-quotes.** A single blockquoted bold line that compresses the surrounding claim, used by most posts:

```markdown
> **A suggestion that can be wrong teaches you to ignore the corner of the screen it lives in.**
```

See [the pull-quote technique](references/voice.md#the-pull-quote-technique) for when to reach for one.

### Ordering

Posts are sorted by `date` in descending order (newest first) automatically by the post loader. No manual ordering is needed — just set the correct `date` in frontmatter.

### Highlighting a shipped feature (changelog banner)

To surface a shipped feature to every user on every page (guests included), tag the announcing post and give it banner copy:

```yaml
tags: ["changelog"]
banner: Keyboard shortcuts arrived in the reader
```

- The **newest** post tagged `changelog` drives a site-wide banner. It shows on the app and on `/blog`.
- A post tagged `changelog` **must** include a `banner:` line — the loader rejects it otherwise.
- The banner stays dismissed (per reader) until the copy changes. The dismissal key is a hash of the slug and the banner text, so editing `banner:` or publishing a newer changelog post makes it reappear for everyone.

For what the banner should *say*, see [Title, description, and banner state the user benefit](references/structure.md#title-description-and-banner-state-the-user-benefit).

---

[What the Post Has to Say, Structural Variety](references/structure.md) — read before planning or structuring a post.

---

---

[Writing Rules, Patterns That Read as Machine-Written](references/writing-rules.md) — read before writing or editing post prose.

---

[Voice](references/voice.md) — read before writing or editing post prose.

---

---

[Figures](references/figures.md) — read when adding or changing an `rp-figure`.

---

## Drafting a Post From Recent Commits

The standing workflow for turning shipped work into a post.

1. **Find the most recent published post and its `date`.**
2. **Gather the commits that landed on `main` after that date.** Summarise the user-facing changes and the technical improvements separately.
3. **Pick one topic** — the one that does most to make Readplace visible to the customers who matter for paid conversions, weighing both search and generative-engine discoverability. A product feature that matters to paying customers, or a technical detail that demonstrates a real advantage. One topic, one post.
4. **Run the [lookback](references/structure.md#the-lookback-do-this-before-writing-a-word)** before writing a word.
5. **Propose a [voice](references/voice.md#choosing-a-voice)** and confirm it before drafting.
6. **Draft**, following every rule in the `references/` files linked above.
7. **Verify** against the checklist below.

If there are no meaningful commits since the last post, or no topic is suitable for external communication, say so briefly and suggest waiting for the next batch. A post with nothing to announce is worse than no post.

A post tagged `changelog` announces a shipped change to every reader of the product, so it must state plainly which problem it solves and what the reader gets. See [Title, description, and banner state the user benefit](references/structure.md#title-description-and-banner-state-the-user-benefit).

---

## Testing

Do not create new tests when adding or removing blog posts. The existing tests validate the blog infrastructure (discovery, rendering, SEO) and are written to work regardless of which posts exist.

If adding or removing a post breaks any test, rewrite the broken test so it no longer couples to a specific post. Tests should derive their expectations dynamically from the loaded posts (e.g. the first post in the loader's sorted list, or one of the slugs it reports) rather than hardcoding a slug, title, or date.

## Verification

After adding or moving a blog post:

1. Confirm the frontmatter satisfies the [schema](#frontmatter-schema). A violation throws at load, so it fails the whole blog rather than the one page.
2. Run the project's test suite to confirm the post is discovered and parsed without errors
3. Check that the post loader returns the new post alongside existing ones
4. Confirm the post is accessible at `/blog/{slug}`

A malformed `rp-figure` throws while the posts load, so it surfaces as a failure of the loader's existing tests, which load every post, rather than at a Lambda cold start. If you added one, also open the post and operate it — with a real click, not by setting `.checked` from the console, which does not always trigger the `:has()` invalidation a user event does.

For a newly drafted post, the checks that matter are not mechanical. Read the last 8 posts, then read the draft. If it could sit in that list without a reader noticing a change in shape, it is not done.
