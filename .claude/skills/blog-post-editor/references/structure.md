## What the Post Has to Say

### Title, description, and banner state the user benefit

A post announcing a shipped change must make the problem it solves legible. Three fields carry that, and they reach the reader in different places, so all three have to work on their own:

| Field | Where the reader meets it |
|---|---|
| `banner` | The in-app banner, on every page, guests included |
| `title` | The post `<h1>`, the `<title>`, og/twitter titles, the JSON-LD headline |
| `description` | The blog index card, the meta description, og/twitter descriptions, JSON-LD |

For typical lengths, measure the three fields across the last 8 posts during the lookback.

The banner is the one an existing user sees first, and it is the only one of the three the banner renders. The banner markup carries the `banner:` hook and a literal "Learn more" link — it never renders `title` or `description`. Those two reach a reader who has already landed on the post or seen it in an index or a search result.

So none of the three may be a bare feature name. Name what the reader could not do before, or what went wrong that no longer does.

**The banner has a second constraint that pulls against the first.** It is a conversion surface, so it keeps a curiosity gap: state *what* changed and let the click reveal *how*. Where the two pull apart, resolve it this way: **name the problem, withhold the mechanism.**

- **Concise hook with a curiosity gap.** Name what the reader gets, then stop: *"Deleting an account is a thing you type out by hand"*. The three ways to miss are a bare feature name, which states no benefit (*"Sign in with Apple"*); the full mechanism, which leaves nothing to click for (*"Account deletion now requires typing a confirmation phrase into a text field"*); and any "I", "we" or team subject.
- **Let the bar carry the novelty.** Do not write "New:" or "Just shipped" in the hook.
- **Brand voice.** No emoji, no exclamation marks, no superlatives. Talk like a person.

### Never date-bind pricing or promotions

Do not reference pricing, discounts, founding-member counts, or promotions that are true only at one point in time. A line like "free for the first 500 founding members, $3.99/month after that" is read by someone arriving a year later, after the window closed and the price moved. They see copy that does not match the product and they stop trusting the rest of the post.

Write the behaviour, not the offer. If a price is genuinely the subject of the post, name the page that holds the current one and link to it instead of restating the number.

## Structural Variety

**This section overrides every other rule in this skill, [Voice](voice.md#voice) and [Writing Rules](writing-rules.md#writing-rules) included.** Where any rule tells you to open, close, or shape a post one way and this section caps that way, this section governs — each voice's Opening *and* Closing included, along with the second-person figure in [Measured register](writing-rules.md#measured-register).

Every post must be visibly different in shape from the posts before it. The published corpus has drifted into a handful of default shapes, so a reader scanning the feed sees the same opening, the same section rhythm, and the same sign-off again and again. Break that sameness on purpose.

The operative test is always **this post against the last 8 published posts**. There is no batch and no shape is rationed per batch.

### The lookback (do this before writing a word)

Posts are ordered by the frontmatter `date:` value, not by filename and not by git history, because `date` is what the post loader sorts on and what the reader sees. Read the `date:` line out of each post in the directory, sort descending, and take the top 8. Build the command yourself against the directory you resolved in [Finding the Posts Directory](../SKILL.md#finding-the-posts-directory).

For each of those 8, record:

- **a.** The first word and the opening move of the body — the grammatical and rhetorical shape of the first sentence, not its topic.
- **b.** The first word of the second sentence, and whether sentence 2 returns to direct second-person address ("You …", "So you …", "When you …").
- **c.** The first word of the TL;DR, and whether it opens on the product name "Readplace …".
- **d.** The exact wording of the second-to-last section header.
- **e.** The exact wording of the final section header.
- **f.** The exact wording of the closing call-to-action sentence — the line in the body that wraps the links. Note that several posts trail their call to action with a one-line closer, so the last line of the file is not reliably the call to action.
- **g.** For any of the 8 that reconstructs an incident, the exact wording of its closing lesson line.

Your new post must differ from all 8 on every axis it shares with them. "Differ" means a different first word and a different shape, not a synonym dropped into the same shape.

This is a check against what already exists, not a list to rotate through. Do not build a fixed wheel of openings and cycle it. Read the recent posts, find the shape they share, and write the entry this specific post's material wants — the actual number, object, claim, or moment at the centre of it — that the recent posts did not use. Derive the opening from the material, not from a list.

### The saturation map

These describe the corpus as it stands, measured over the 67 published posts. Re-measure rather than trusting these figures if the corpus has grown much past that. Each axis is governed by the lookback: do not repeat the shape any of the last 8 posts used.

- **Opening (axis a).** Three shapes are over-represented: the second-person scenario ("You …" / "Your …", 11 posts), the first-person past-tense anecdote ("I saved …", "I went …", "I was reading …", 5 posts), and the third-person anecdote ("A user …", "A reader …", "A [noun] …", 3 posts opening on a named generic person). The cold open on a small relatable scene underlies all three and is the single most repeated device in the corpus. Move away from them. Narrative Voice, where the scene opening *is* the voice, may still open on a scene, but only when no recent post did.
- **Second and third sentences (axis b).** When the first sentence avoids direct address, do not let the paragraph snap back to "You …", "So you …", or "When you …" by the second or third sentence. Of the 56 posts that vary the first line, 15 bring "you" back inside the next two sentences. The whole opening paragraph carries the variation, not just its first word.
- **TL;DR opener (axis c).** The TL;DR opens on the product name in 16 of 67 posts ("Readplace now …", "Readplace keeps …", "Readplace runs …"), and its first sentence names Readplace somewhere in 30. Do not lead the TL;DR with the product name if any of the last 8 did. Open on the reader's situation or the concrete change, then name Readplace in the second sentence.
- **Section headers (axes d, e).** Two shapes are the most repeated in the corpus: "Why this matters" in every form ("Why it matters", "Why this matters to you", "Why this matters now", "Why this helps you") closes the argument in 7 posts, and "Try it" ("Try it on …", "Try this today") is the final header in 10. Name the closing section for what it actually argues, and name the action section for the specific action it asks for. Keep header casing consistent inside one post — all sentence case or all title case, never a mix.
- **Closing call to action (axis f).** The sign-off recent posts share repeats almost word for word — an install link and then a site-root link, "Install the browser extension … or start at readplace.com." Search the lookback window for the link text `start at [readplace.com]` (link tagging does not change it) to see how many closings already use it. The links can stay. The sentence around them must not be a template.
- **War-story closer (axis g).** Posts that reconstruct an incident tend to close on "The lesson I took from this …". Do not reuse that frame if a recent incident post used it. A war story can end on the fixed behaviour or the result and leave the lesson unstated.

### Two failure modes

- **Slow rotation.** The 8-post window will eventually let a saturated shape back in. Do not take that as a cue to cycle them. When the window would permit a saturated shape, still prefer an entry the material offers over falling back to it.
- **New monoculture.** Breaking the old shapes must not converge on one new shape. A blog where every post opens on a flat declarative claim is as templated as one where every post opens on "You". No single replacement is the safe default.

**The test for the whole draft:** read the last 8 posts, then read yours. If your draft could sit in that list and a reader scanning the feed would not notice a change in shape, find the part that blends in and rewrite it.
