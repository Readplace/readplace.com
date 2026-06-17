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
