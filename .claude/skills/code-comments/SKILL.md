---
name: code-comments
description: When a code comment may exist and the human-approval gate that must be cleared before one is written. Use when adding, editing, retaining, or removing any code comment (`//`, `/* */`, `/** */`, `<!-- -->`, `{{!-- --}}`, `#`), when reviewing a diff that touches comments, or when asked to clean up / trim / de-stale / de-time-bind comments. This is the single source of truth for comment policy across the repo.

---

# Code Comments

Prefer code that explains its own why — a clearer name, a type, an `assert`, or a test — over any comment. Remove comments freely, and more often than you add.

## A comment may exist for exactly two reasons

1. **A why that neither the code nor the history can carry.** Before writing a why-comment, confirm the reason cannot be carried by a clearer name, a type, an `assert`, or a test — and is not already recoverable from the commit message or the linked PR that introduced the line. If `git blame` → commit → PR already explains it, the comment is a redundant copy: put the why there, not in the code.
2. **An approved hack.** A deliberate deviation where the proper solution was consciously declined — e.g. a `c8 ignore` with a reason (see CLAUDE.md → [Code Coverage](../../../CLAUDE.md#code-coverage)), an HTTP/2 fallback, a workaround for an upstream bug. The comment records *why the proper fix was skipped*. The decision to skip the proper fix must have been approved by the human.

Every other comment — including all *what* and *how* comments — does not belong in the code.

## Ask before writing, never after

Adding any comment — a why-comment, a hack-comment, or anything else — requires explicit human approval in the working session, obtained **before the comment is written**. There is no category of comment you may introduce unprompted. Removing a comment never needs approval.

Ask with the `AskUserQuestion` tool, quoting the exact comment text you propose and the line it would sit on, so the human approves the wording rather than the idea of a comment. Batch every proposed comment in a change into one question; do not ask per comment.

Write the code without the comment first. If approval is refused, or the tool is unavailable, the change ships without it — a missing comment is never a blocker.

Writing a comment and then asking whether to keep it is the wrong order and is not permitted: it makes the human a reviewer of work already done rather than the person who decided it should exist, and an unanswered question leaves an unapproved comment sitting in the diff.

## Never

| Don't | Why |
|---|---|
| Document *what* or *how* the code does | The code is the source of truth; the comment rots the moment the code changes |
| Name another file or symbol by path in a comment | The path goes stale silently when that file is moved or renamed — express the link in code (an `import`), or put it in the commit/PR |
| Restate a why the commit message or linked PR already carries | The comment is the duplicate that drifts out of date |
| Leave time-, plan-, or PR-bound notes ("for now", "currently", "after the migration", "added for #123") | Encode any genuine revisit condition in a failing test, a flag with an owner, or a tracked issue — not prose |

```typescript
// BAD - explains what (obvious from code), or assumes a moment in time
// Re-export template function
// Temporary: remove this branch after the migration to v2 is complete

// GOOD - explains a why the code cannot carry
// Bookings older than 90 days are purged by the airline, so re-fetch instead of caching
cacheTtlMs: 0,

// GOOD - constraint enforced by assert, so no comment to rot
function handle(req: Request) {
	assert.equal(req.method, "GET");
}
```

## Formatting an approved comment

A single-line explanation of one line goes inline:

```typescript
seatHoldRetryMs: 0, // the booking sandbox releases a held seat after a second, so the retry cannot wait
```

An explanation spanning multiple lines uses indexed references, so it stays together and each line is traceable:

```typescript
/** 1. DynamoDB stores missing attributes as null, not undefined. .nullish() accepts both. */
const BookingRow = z.object({
  seatPreference: z.string().nullish(), /* 1 */
  frequentFlyerId: z.string().nullish(), /* 1 */
});
```

## Keep the diff minimal

When removing a comment, change only the comment lines. Do not re-indent, reflow, rename, or reformat the surrounding code in the same edit — a comment-removal change should be a comment-removal diff. Bundling unrelated cleanup hides the change and inflates review.
