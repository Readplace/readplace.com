---
name: blog-post-editor
description: Blog post authoring conventions, plus the writing, structure, and voice rules a post must follow. Use when creating, editing, moving, or troubleshooting blog posts. Triggers on blog content work, markdown files intended for the blog, or questions about the /blog route.
---

# Blog Post Editor

Drafting a post is the highest-effort task in this repo. Run it at maximum effort on the strongest model available. A post ships under a person's name to every reader of the product, and a draft that reads as machine output costs more than the time saved writing it.

**Precedence.** [Structural Variety](#structural-variety) overrides every other section in this file. Where a voice, an opening rule, or a register figure tells you to write one way and Structural Variety caps that way, Structural Variety wins.

**Scope of the writing rules.** Everything from [What the Post Has to Say](#what-the-post-has-to-say) down governs *post prose*. It does not govern this file, `BRAND_GUIDELINES.md`, code comments, or commit messages, all of which use punctuation the post rules ban. Quoted material is also exempt: a direct quote, an error string, or a screenshotted UI label belongs to its source, so do not edit it to satisfy a rule here.

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

**Every post opens with a TL;DR disclosure.** This is hand-written HTML at the top of the markdown, before the first heading, and it is the same in all posts:

```html
<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

One paragraph summarising the post.

</div>
</details>
```

The blank lines inside the `div` are required, or markdown will not render the paragraph. The `blog-tldr__toggle` class is load-bearing: the post loader's render step matches on it to inject the disclosure caret at render time (grep for the class in the blog's TypeScript — the one hit outside the stylesheet and the posts), so a `<summary>` without that exact class silently loses its chevron. The `blog-tldr` class names are a content contract rather than code identifiers: every published post carries this block verbatim, so renaming one means editing every post, and this skill names them on purpose.

**Citing an external article.** Link through the reader rather than off the site. Drop the `https://` scheme and append the rest to `/view/`, as a root-relative link:

```markdown
[research post about poisoning language models](/view/www.anthropic.com/research/small-samples-poison)
```

The `/view/` path builder — the function that turns an article URL into that path, in the module that percent-encodes `?` and `#` (grep for `%3F` in TypeScript outside test files) — is the source of truth for the transformation: `https://` is dropped, `http://` is kept literally because it is the minority case, slashes stay unencoded, and `?` and `#` inside the article URL become `%3F` and `%23` so Express's query parser does not claim them. Use the relative form. One post uses an absolute `https://readplace.com/view/...` link and it is an outlier, not the convention.

**Pull-quotes.** A single blockquoted bold line that compresses the surrounding claim, used by most posts:

```markdown
> **A suggestion that can be wrong teaches you to ignore the corner of the screen it lives in.**
```

See [the pull-quote technique](#the-pull-quote-technique) for when to reach for one.

### Ordering

Posts are sorted by `date` in descending order (newest first) automatically by the post loader. No manual ordering is needed — just set the correct `date` in frontmatter.

### Highlighting a shipped feature (changelog banner)

To surface a shipped feature to every user on every page (guests included), tag the announcing post and give it banner copy:

```yaml
tags: ["changelog"]
banner: I added keyboard shortcuts to the reader
```

- The **newest** post tagged `changelog` drives a site-wide banner. It shows on the app and on `/blog`.
- A post tagged `changelog` **must** include a `banner:` line — the loader rejects it otherwise.
- The banner stays dismissed (per reader) until the copy changes. The dismissal key is a hash of the slug and the banner text, so editing `banner:` or publishing a newer changelog post makes it reappear for everyone.

For what the banner should *say*, see [Title, description, and banner state the user benefit](#title-description-and-banner-state-the-user-benefit).

---

## What the Post Has to Say

### Title, description, and banner state the user benefit

A post announcing a shipped change must make the problem it solves legible. Three fields carry that, and they reach the reader in different places, so all three have to work on their own:

| Field | Where the reader meets it | Measured length across published posts |
|---|---|---|
| `banner` | The in-app banner, on every page, guests included | 26–69 characters, median 54 |
| `title` | The post `<h1>`, the `<title>`, og/twitter titles, the JSON-LD headline | 21–88 characters, median 50 |
| `description` | The blog index card, the meta description, og/twitter descriptions, JSON-LD | 115–416 characters, median 235 |

The banner is the one an existing user sees first, and it is the only one of the three the banner renders. The banner markup carries a `NEW` chip, the `banner:` hook, and a literal "Read more" link — it never renders `title` or `description`. Those two reach a reader who has already landed on the post or seen it in an index or a search result.

So none of the three may be a bare feature name. Name what the reader could not do before, or what went wrong that no longer does.

**The banner has a second constraint that pulls against the first.** It is a conversion surface, so it keeps a curiosity gap: state *what* changed and let the click reveal *how*. Where the two pull apart, resolve it this way: **name the problem, withhold the mechanism.**

- **Concise hook with a curiosity gap.** Name what the reader gets, then stop: *"I made deleting an account a thing you type out by hand"*. The two ways to miss are a bare feature name, which states no benefit (*"I added Sign in with Apple"*), and the full mechanism, which leaves nothing to click for (*"Account deletion now requires typing a confirmation phrase into a text field"*).
- **Let the NEW chip carry the novelty.** Do not write "New:" or "Just shipped" in the hook.
- **Brand voice.** No emoji, no exclamation marks, no superlatives. Talk like a person.

### Never date-bind pricing or promotions

Do not reference pricing, discounts, founding-member counts, or promotions that are true only at one point in time. A line like "free for the first 500 founding members, $3.99/month after that" is read by someone arriving a year later, after the window closed and the price moved. They see copy that does not match the product and they stop trusting the rest of the post.

Write the behaviour, not the offer. If a price is genuinely the subject of the post, name the page that holds the current one and link to it instead of restating the number.

---

## Structural Variety

**This section overrides every other rule in this file.** Where any rule tells you to open, close, or shape a post one way and this section caps that way, this section governs — each voice's Opening *and* Closing included, along with the second-person figure in [Measured register](#measured-register).

Every post must be visibly different in shape from the posts before it. The published corpus has drifted into a handful of default shapes, so a reader scanning the feed sees the same opening, the same section rhythm, and the same sign-off again and again. Break that sameness on purpose.

The operative test is always **this post against the last 8 published posts**. There is no batch and no shape is rationed per batch.

### The lookback (do this before writing a word)

Posts are ordered by the frontmatter `date:` value, not by filename and not by git history, because `date` is what the post loader sorts on and what the reader sees. Read the `date:` line out of each post in the directory, sort descending, and take the top 8. Build the command yourself against the directory you resolved in [Finding the Posts Directory](#finding-the-posts-directory).

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
- **Closing call to action (axis f).** The sign-off recent posts share repeats almost word for word — "[Install the browser extension](https://readplace.com/install) or start at [readplace.com](/)." — and `[readplace.com](/)` appears in the closing of 38 of 67 posts. The links can stay. The sentence around them must not be a template.
- **War-story closer (axis g).** Posts that reconstruct an incident tend to close on "The lesson I took from this …". Do not reuse that frame if a recent incident post used it. A war story can end on the fixed behaviour or the result and leave the lesson unstated.

### Two failure modes

- **Slow rotation.** The 8-post window will eventually let a saturated shape back in. Do not take that as a cue to cycle them. When the window would permit a saturated shape, still prefer an entry the material offers over falling back to it.
- **New monoculture.** Breaking the old shapes must not converge on one new shape. A blog where every post opens on a flat declarative claim is as templated as one where every post opens on "You". No single replacement is the safe default.

**The test for the whole draft:** read the last 8 posts, then read yours. If your draft could sit in that list and a reader scanning the feed would not notice a change in shape, find the part that blends in and rewrite it.

---

## Writing Rules

### Positive directives

- **Clarity and brevity.** Sentences that focus on a single idea. Average 10–20 words, with real variance.
- **Active voice** about 90% of the time. See [Name the actor](#name-the-actor) for how this rule is scoped.
- **Everyday vocabulary.** Substitute common, concrete words for abstraction.
- **Straightforward punctuation.** Periods, commas, question marks, and occasional colons for lists.
- **Varied sentence length, minimal complexity.** Mix short, medium, and long. Avoid stacking clauses.
- **Logical flow without buzzwords.** Build arguments with plain connectors: *and*, *but*, *so*, *then*.
- **Concrete detail over abstraction.** Numbers, dates, names, and measurable facts wherever possible.
- **Human cadence.** Vary paragraph length. Ask a genuine question no more than once per 300 words, and answer it immediately.
- **Numerals over spelled numbers** for anything measured: *3* not *three*, *13* not *thirteen*. This covers counts, durations, prices, and sizes. It does not cover idiom or doctrine, where the numeral breaks the sentence: "Readplace is one word, not two" is about words, not a quantity, and "there is one button in the product" names a rule.

### Measured register

These numbers come from 11 of the author's pre-2024 posts, 11,476 words. They define the target cadence, so match the distribution and not just the average. There is no tool in this repo that measures a draft against them — check them by reading.

- Average sentence 17.8 words, standard deviation 10.3. **The variance is the signature.**
- One sentence in five runs 25 words or longer. One in six runs 8 words or shorter.
- Half of all paragraphs are a single sentence (49.9%). The standalone line is structure, not decoration. Each voice below also gives a typical paragraph length; read those as the shape of the *multi-sentence* paragraphs, not as a floor that rules the standalone line out.
- Contractions about 25 per 1,000 words. Commas about 41 per 1,000 words.
- Second person belongs inside paragraphs, not at the top of a post or its TL;DR, which Structural Variety caps. Across a whole post the reference register runs "you" at about 24 per 1,000 words against 3.7 for "I". The 24 is a body-text ceiling to stay under, not a quota to reach, and none of it belongs in the opening line. The 3.7 is a reference frequency rather than a cap — the first-person voices run higher, and War Story runs higher still. This caps *position and rate in post prose*. It does not touch quoted UI copy, where "Your article is saved" is the endorsed shape.
- The older register allowed semicolons, em dashes, and exclamation marks at low rates. The rules below ban them anyway. That is a deliberate break, not an oversight.

### Punctuation, words, and phrases to avoid

**Punctuation.** No semicolons. No em dashes.

> ✗ I researched this for a week; the results were clear.
> ✓ I researched this for a week, and the results were clear.

> ✗ The idea — though interesting — was rejected.
> ✓ The idea was interesting but was rejected.

**Never use these, in any form or capitalization:**

At the end of the day, With that being said, It goes without saying, In a nutshell, Needless to say, When it comes to, A significant number of, It's worth mentioning, Last but not least, Cutting-edge, Leveraging, Moving forward, Going forward, On the other hand, Notwithstanding, Takeaway, As a matter of fact, In the realm of, Seamless integration, Robust framework, Holistic approach, Paradigm shift, Synergy, Scale-up, Optimize, Game-changer, Unleash, Uncover, In a world, In a sea of, Digital landscape, Elevate, Embark, Delve, In the midst, In addition, It's important to note, Delve into, Tapestry, Bustling, In summary, In conclusion, Remember that, Take a dive into, Navigating, Landscape (metaphorical), Testament (as in "a testament to"), In the world of, Realm, Virtuoso, Symphony, vibrant, Firstly, Moreover, Furthermore, Therefore, Additionally, Specifically, Generally, Consequently, Importantly, Similarly, Nonetheless, As a result, Indeed, Thus, Alternatively, Notably, Essentially, Arguably, To consider, Ensure, Essential, Vital, Out of the box, Underscores, Soul, Crucible, It depends on, You may want to, This is not an exhaustive list, You could consider, As previously mentioned, It's worth noting that, To summarize, Ultimately, To put it simply, Pesky, Promptly, Dive into, In today's digital era, Reverberate, Enhance, Emphasise, Enable, Hustle and bustle, Revolutionize, Folks, Foster, Sure, Labyrinthine, Moist, Remnant, As a professional, Subsequently, Nestled, Labyrinth, Gossamer, Enigma, Whispering, Sights unseen, Sounds unheard, Dance, Metamorphosis, Indelible

> ✗ Cutting-edge analytics will revolutionize your workflow.
> ✓ The software measures performance faster.

**Single words to ban:** moreover, furthermore, additionally, consequently, therefore, ultimately, generally, essentially, arguably, significant, innovative, efficient, dynamic, ensure, foster, leverage, utilize, thrilled, delighted.

> ✗ We must leverage dynamic, innovative approaches.
> ✓ I tried a different method.

**Multi-word phrases to ban:** "I apologize for any confusion", "I hope this helps.", "Please let me know if you need further clarification.", "One might argue that", "Both sides have merit.", "Ultimately, the answer depends on", "This is not an exhaustive list, but", "Dive into the world of", "Unlock the secrets of", "I hope this email finds you well.", "Thank you for reaching out.", "If you have any other questions, feel free to ask."

**Function words that are allowed.** These were banned in an earlier version of these rules. They appear at natural frequency in the reference register, they are grammar rather than buzz, and removing them creates a third register that belongs to nobody:

*because, while, also, although, even though, even if, despite, unless, due to, in order to, given that, as well as, in contrast, in other words, would, could, might, may, tend to, tends to*

Allowed does not mean unlimited. The overuse rules below still apply to all of them.

**"However" is capped, not banned.** It is the most frequent connective in the pre-2024 register (28 uses across 11 posts) and, at the same time, one of the loudest machine tells today. Use it at most once per post. Try "But" or a restructure first. Never open two paragraphs in a row with it. The published corpus currently uses it zero times as a conjunction, so the cap is not a licence to introduce one.

**Parts of speech to minimize:**

| Class | Words |
|---|---|
| Conjunctive adverbs | however, moreover, furthermore, additionally, consequently, ultimately, generally, essentially |
| Verbs | ensure, foster, leverage, utilize |
| Adjectives | significant, innovative, efficient, dynamic |
| Nouns | insight(s), perspective, approach(es) |

Modals (*would, could, might, may*) are allowed as grammar. Do not stack hedges ("might possibly", "could perhaps"), and do not use a modal where you can name the concrete condition instead.

### Sentence and formatting rules

**Eliminate complex, multi-clause sentences.**

> ✗ Because the data were incomplete and the timeline was short, we postponed the launch, although we had secured funding.
> ✓ The data were incomplete. I had little time. I postponed the launch. Funding was ready.

Also avoid: overuse of subordinating conjunctions (because, although, since, if, unless, when, while, as, before); sentences containing more than one verb phrase; chains of prepositional phrases; multiple dependent clauses strung together; artificial parallelism used solely for rhythm.

**Formatting.** Do not begin list items with transition words. Avoid numbered headings unless an outline was asked for. Do not use ALL-CAPS for emphasis.

**Tone.** Never reference your own limitations. Do not apologize. Do not hedge — state facts directly. Avoid clichés and metaphors about journeys, music, or landscapes. Formal but approachable, free of corporate jargon. Match contraction usage to the surrounding text: contraction density is not a marker of human writing, so do not tune it in either direction to sound more casual or more human.

Failure to comply with any of these invalidates the draft. When writing, think about each sentence and check it against these rules before moving to the next one.

---

## Voice

The [brand guidelines](../../../BRAND_GUIDELINES.md#voice--copy) own the product voice — solo founder writing as "I", quiet and specific, no hype. Write as "I", never as "we". The impersonal product voice ("Readplace writes the summary when the save finishes") stays available and is often the better choice, as the next section explains.

### Name the actor

**Prefer the active voice. When a sentence hides who acted, name them.** In almost every case the actor is Readplace, the code, a site, the reader, or the author, and naming it is shorter and more honest.

> A summary is generated when the save finishes.

> Readplace writes the summary when the save finishes.

The product already holds itself to this: the TL;DR prompt described in the post at `/blog/how-ai-tldr-actually-works` demands "active voice, short sentences, plain connectors, specific facts, and no jargon" of the model. The blog should not write worse than the summariser it ships.

**This is not a ban.** A passive is correct, and should be left alone, when:

- The actor is genuinely unknown or irrelevant — *"The page was re-saved through Aspose."*
- The receiver is the topic and naming the actor would bury it — *"Your article is saved."* is the shape the [writing principles](../../../BRAND_GUIDELINES.md#writing-principles) endorse; *"Summaries are capped at 750 characters"* is about the cap.
- Naming an actor would over-claim, attributing a decision to a component that does not make it.
- It is quoted UI copy, an error string, or a term of art (*source-available*).
- The active version reads longer or shifts emphasis off the point.

And these are not passives at all, so don't "fix" them: adjectival participles (*saved articles*, *the stored copy*), present perfect (*has shipped*), and idiomatic get-passives (*the redirected hop is refused too*).

Ten real fixes beat forty that flatten the prose. A sweep that de-passivises everything reads like a machine went through it, which is the one thing this blog is arguing against.

### Choosing a voice

Five voices are available. Before drafting, state in one sentence what the post is about, name the voice you think fits and why, and ask the person to confirm or pick another. If the material sits between two, name both and let them decide.

Then draw the content out of them **one question at a time**, so they make the content decisions rather than reviewing decisions you already made. A batch of questions gets a batch of shallow answers.

| The post… | Voice |
|---|---|
| makes a single claim and proves it with one example | [Principle](#voice-1-principle) |
| describes a type of person, behaviour, or cultural pattern | [Observer](#voice-2-observer) |
| reconstructs a real incident and extracts a lesson | [War Story](#voice-3-war-story) |
| tells a personal story where tension and pacing matter | [Narrative](#voice-4-narrative) |
| proposes a framework, scoring system, or structured model | [Framework](#voice-5-framework) |

### Shared rules across voices

**Perspective.** First person, "I" not "we". Speak as a practitioner sharing what you learned, not as a teacher instructing. Never position yourself as an authority — let the ideas carry the weight. Assume the reader is a peer, not a student.

**Opening variety.** Structural Variety governs every opening. No voice gets to default to one fixed opening shape. The example openings under each voice show the archetype's *subject matter*, not a first word to copy: read them as "this is the kind of thing this voice notices".

**Sentences.** One idea per sentence. Follow a long sentence with a short one, and let the short one land the point. Average 10–20 words, with one sentence in five running past 25. Avoid subordinate clauses where a new sentence works. Never more than three sentences in a row without a paragraph break, Narrative Voice excepted.

**Paragraphs.** One idea per paragraph. If a paragraph runs long it holds two ideas, so split it. Blank line between every paragraph, no exceptions.

**Direction.** Move from the specific to the general. Ground claims in concrete detail before extracting the principle, and build through concrete examples rather than abstract argument, one example per idea.

**Editing standard.** Every sentence must earn its place. If removing it loses nothing, remove it. A short post that lands cleanly beats a long post that wanders.

#### The pull-quote technique

A pull-quote is a single sentence in bold or blockquote that compresses the paragraph's claim. It gives skimmers the skeleton while the surrounding text gives close readers the flesh.

Use one when a paragraph holds a claim worth compressing, and never more than three. Of the published posts that carry any, most carry one or two. Do not add one to a post that has no such claim: a device that fires in every post becomes the sameness [Structural Variety](#structural-variety) exists to prevent.

**Questions.** Genuine questions once per 300 words at most, and only when answered in the next sentence. Rhetorical questions are banned in every voice.

**Tone.** No superlatives (best, revolutionary, game-changing). No exclamation marks. No emoji in body text. No filler transitions. Modest but not self-deprecating: state what you observed, not what you felt about it.

**Words that leak into technical writing most often**, on top of the general ban list: "journey", "deep dive", "game-changer", "takeaway", "unpack", "landscape", "realm", "delve".

**What to avoid in every voice:**

- Do not summarize what you just said at the end of a section.
- Do not tell the reader what they are about to learn.
- Do not repeat the same point in different words to fill space.
- Do not use passive voice where active is possible.
- Do not withhold a concrete word for effect. If you can name the thing, name it now. A vague placeholder followed by the real noun a few sentences later reads as manufactured suspense. "It rests on something more durable" stalls in front of a word the post already has: relational algebra. Use the word.

### The five voices

#### Voice 1: Principle

**When to use:** the post makes a single claim and proves it with one example. Titles like "X Doesn't Matter" or "X Is a Smell". **This is the tightest mode. Every sentence earns its place or gets cut.**

*Opening.* The lookback governs your first line. The belief-then-invert move is one entry this voice can use, not a required opener: state a short declarative observation that sounds true, then immediately complicate or invert it. When you use it, do not start with "I" or with a question.

*Structure.* Open with the assertion. Prove it with one concrete example — one, not three. Move from the specific to the general. End when the point is made.

*Paragraphs.* Two to four sentences maximum.

*Section breaks.* A thematic sentence standing alone on its own line, crystallizing the point of what follows. For example: "Attention is what you can't get back once it's gone."

*Closing.* A two-line contrast: the first line restates the conventional goal, the second replaces it with the better one. "Writing code faster is a reasonable goal. Writing it without interruption is a better one."

This is not the staccato "Not X. Y." punchline banned below. A valid contrast uses two complete thoughts with specific content, and it should be the kind of line someone could pull out and share on its own. A fake contrast uses fragments that negate and assert without substance ("Not hype. Reality."). If both lines cannot stand alone as full sentences with real meaning, cut it. **Do not use this closing if any of the last 8 posts closed on a two-line contrast** — when the point lands cleanly in the final paragraph, let the post end there.

*Length.* 800 to 1,200 words. Shorter is fine if the post is done.

#### Voice 2: Observer

**When to use:** the post describes a type of person, behaviour pattern, or cultural phenomenon. **This is the most human mode. You are naming something people recognize but haven't articulated.**

*Opening.* Whatever entry the material wants, checked against the lookback. Second-person observation is one way in, not the default, and it is capped. You can place the reader inside a recognizable behaviour without opening on the word "You": name the behaviour, the type, or the moment first, then bring the reader in.

*Perspective shift.* This voice uses "you" to describe archetypes — "you" here means "a person like this", not the reader directly. Switch back to "I" for your own experience or interpretation.

*Structure.* Open with the observable behaviour. Build the profile through specific details: what these people do, say, and avoid. Reference a named concept (Dunning-Kruger, Goodhart's Law) only if it sharpens the observation, never as the foundation. Close with empathy or a reframe — you are describing something you have seen and probably been, so do not mock it.

*Paragraphs.* Two to five sentences. This voice needs slightly more room.

*Tone.* Reflective and measured, with more space between claims than the Principle voice. Qualify with concrete conditions, not modals: "This pattern shows up more in teams that ship weekly" is fine, "This could work for smaller teams" is not.

*Closing.* No required format. End when the observation is complete. If a two-line contrast fits, use it, subject to the same shareable-line test as Voice 1. If the final paragraph already closes the loop, stop there.

*Length.* 800 to 1,400 words.

#### Voice 3: War Story

**When to use:** the post reconstructs a real incident, bug, outage, or debugging session. **This is the most readable mode. The reader discovers the point alongside you.**

*Opening.* Start with the incident. Name the technology, the context, and what went wrong, and drop the reader into the middle of the problem rather than working up to it. Run the lookback first: if recent posts opened on "I [past tense]" or "A user saved …", find another way in. The incident can start on the system, the symptom, the number, or the broken output, not only on a person.

*Structure.* Chronological. Describe the debugging path step by step, including the wrong turns. Name the technologies involved — specifics make war stories credible. Extract the lesson at the end, not the beginning.

*Paragraphs.* Short, two to three sentences.

*Tone.* Procedural and grounded. No drama, the facts carry the tension. Be self-aware about your own mistakes: you are not the hero of the story, the debugging process is.

*Closing.* State what you learned in one or two sentences. Do not generalize beyond the incident unless the generalization is earned, and do not announce it with "The lesson I took from this …" if a recent incident post used that frame. The ending can land on the fixed behaviour or the result and let the lesson sit unstated.

*Length.* 600 to 1,000 words. War stories that run long lose their punch.

#### Voice 4: Narrative

**When to use:** the post tells a personal story where tension, pacing, and sensory detail matter. Rare — origin stories, life events, formative experiences. **This is the widest-range mode. Sentence and paragraph rules loosen to serve the story.**

*Opening.* The cold sensory scene is the corpus's most over-used opening, so this is the one voice whose defining move collides with axis a. Resolve it this way: the scene opening *is* the voice, so you may use it, but only when no recent post opened on a scene, and you must still vary the scene's first word and shape against the last 8. When the lookback permits a scene, drop the reader into it with sensory detail — what you saw, heard, or physically felt. Do not set up context first. Start in the middle.

*Structure.* Chronological — the structure follows time, not argument. Build suspense through pacing, not by withholding information. Atmospheric detail is encouraged here when it builds tension.

*Paragraphs.* Variable. Some are one sentence, some run to five or six when the scene demands it. The three-sentence break rule does not apply. Blank lines between paragraphs still do.

*Sentences.* Shorter during high tension, longer while setting a scene. Let the rhythm mirror the pacing of the event. The bans on multi-verb-phrase sentences and stacked clauses relax during scene-setting; action and dialogue follow the standard rules.

*Tone.* Vulnerable and self-aware, admitting fear, bad decisions, and uncertainty. Still no self-deprecation for its own sake.

*Closing.* End on the aftermath or the quiet moment after the tension breaks. Do not moralize.

*Length.* 600 to 1,500 words. Length follows the story.

#### Voice 5: Framework

**When to use:** the post proposes a framework, scoring system, mental model, or structured evaluation method. **This is the most formal mode. Authority comes from the structure of the argument, not from personal anecdote.**

*Opening.* Stating the problem the framework solves is this voice's natural entry. Use it when the lookback allows, and be specific about who has the problem and when. If a recent post already opened by stating a problem, find another way in.

*Structure.* Open with the problem. Introduce the framework by name, and say plainly if you coined it. Define each component with one concrete example. Show how the components interact. Acknowledge what the framework does not cover.

*Paragraphs.* Three to five sentences — this voice tolerates longer paragraphs because the content is structural. Use bolded component names as inline anchors, not as section headers, so the post reads as continuous argument rather than a reference doc.

*Tone.* Authoritative but not impersonal. Reference the experience the framework came from briefly, then let it stand on its own. Honest caveats matter more here than anywhere else: a framework that claims to cover everything is not credible. Qualify with concrete conditions and boundaries, not modals.

*Closing.* State the single question the framework helps answer. Do not oversell it. If you use a contrast closing, it takes the same shareable-line test as Voice 1.

*Length.* 1,000 to 1,500 words. Frameworks need room, but not padding.

### Patterns worth using

**The reframe** — state what people assume, then show what is actually true.

> Most developers use AI to write code faster. The bottleneck was not the typing.

Use sparingly, one per post at most, because the pattern loses force through repetition. A reframe uses two complete, specific sentences. It is not a staccato "Not X. Y." punchline. It also needs three conditions or it is hollow:

- The reader must already hold the assumption you state. If you assigned the reaction to them, cut it. "That claim sounds like nostalgia" assigns a reaction most readers never had.
- The two halves must be real opposites. Nostalgia and durability are not opposites, so a "but" between them joins nothing.
- Do not pre-label how the reader should receive your claim. State the claim, show the proof, let them judge.

**The concrete cost** — make an abstract problem tangible with time or effort.

> That's 20 minutes gone. The fix was simple and the problem was that you had to be the one to do it.

**The ellipsis pause** — three dots where a single period would end the thought too cleanly.

> That's 20 minutes gone... The fix was simple and the problem was that you had to be the one to do it.

**The honest caveat** — acknowledge a limitation before the reader raises it, using "TBH" rather than the word "honest". A colon works here, and so does "=/" when something is genuinely odd or confusing.

> There's something worth clarifying: the workflows don't get it right every time.
> I know this works, but TBH... It only works sometimes =/

Calibration against what is published: **TBH** appears in 4 posts and is real house style. The **ellipsis pause** appears in 1 post. **=/** appears in none. Treat these as available, not expected. A marker force-inserted into every draft becomes its own tell.

**The "not every X" boundary** — closes a section that establishes a limit.

> Not every bug is worth fixing.

Once per post at most. Twice makes it a tic.

### Reference sentences

These show the register to match across all modes.

> Writing code faster is a reasonable goal. Writing it without interruption is a better one.

> Not every feature is worth coding.

> The cognitive difference between handling an interruption and reviewing a result is large. One requires you to stop. The other doesn't.

> Over-engineering is subjective, and the damage of its subjectiveness increases as the requirements fail to present the full picture.

> The internet is open and free, but it forgets.

---

## Patterns That Read as Machine-Written

**1. No fake contrast structures.** Do not use the "Not X. Y." punchline.

- ✗ "This is not opinion. This is math."
- ✗ "Not hype. Reality."
- ✗ "This isn't a bug. It's the system working as designed."
- ✗ "It's less about the syntax. It's more about the model." (the same move in "less about X, more about Y" form)
- ✓ Make the point as a plain statement without setting up a false binary to knock down.

**2. No absolute language.** Do not use: always, never, everyone, no one, proven, solved, permanent, everything, dead (as in "X is dead"). State what changed, who it affects, and to what degree.

**3. No template rhythm.** Do not follow short hook, big claim, three neat support points, dramatic conclusion. Do not use staccato triples.

- ✗ "No vendor. No black box. No negotiation."
- ✗ "Same syntax, same result, same mental model. Thirty-one years, zero changes."

The triple climbs through three phrases with the same grammatical shape, then a kicker lands with a short contrast, often a number. The wind-up plus the payoff is the signature people read as machine prose. This bans repeated grammatical structure, not short sentences: a run of short sentences with different shapes is fine, one short line landing on its own is fine, and a two-line contrast built from two complete, specific sentences is fine.

- ✓ "Maybe punchy writers are using AI. Or maybe it's AI who's using them."

The difference in one line: a single swing is yours, a three-phrase wind-up into a kicker is the machine. The ban targets the grammatical or anaphoric triple, not the number three.

**4. No inflated importance.** A tool release is not a manifesto. A benchmark is not a civilizational warning. State what was built or found and let the reader judge its importance.

**5. No synthetic confidence.** Do not write with more certainty than the topic warrants. Real people qualify, hesitate, and acknowledge that most topics are bigger than one clean sentence. If you are uncertain, say so plainly.

**6. No assembled smoothness.** Prioritize sounding like a specific person over sounding polished. A slightly rough sentence that belongs to someone is worth more than a smooth paragraph that belongs to no one.

The reference register is the author's own older posts, written before reading large volumes of model-generated text. It is not generic clean technical writing. The two have converged, so frictionless, evenly paced prose now reads as machine output even when every sentence is grammatically perfect. This applies to your own current draft: a draft in front of you is not automatically in the author's voice. Check it against the older register in [Measured register](#measured-register), not against how it feels in the moment. **Test: if you cannot tell whether a sentence is the author's or generated, it is too smooth.**

**7. Editing passes do not reshape cadence.** When the job is a grammar or polish pass on text the author already wrote, fix errors and rule violations. Do not reshape anything already correct.

*Fix:* agreement, tense, a broken clause, a typo, a banned word, a semicolon, an em dash.

*Leave:* rhythm, paragraph breaks, sentence length, short standalone lines, and word choices that work. Do not add parallelism, balance a lopsided sentence, insert a numeric kicker, or merge short paragraphs.

- ✗ Editing "SQL queries from 1995 run unchanged today" into "Written in 1995, these queries still run unchanged, a span of thirty-one years."
- ✓ Leaving it as written.

If a fix would change how a correct sentence sounds, find a smaller fix. Leave direct quotes untouched even when they contain a banned word, an em dash, or a semicolon.

**8. No "win" framing.** Do not score outcomes as wins. Name the actual result. Not "that's a win for the team" but "testing first catches the regression before it ships".

**9. No "quietly" narrator voice.** Drop the spy-thriller staging that frames an ordinary fact as a secret move: "quietly", "behind the scenes", "under the radar", "without fanfare", "silently rewriting".

**10. No abstract container words.** Cut empty vessels standing in for a concrete noun: vague "opportunity", "space", "distance", "gap". Test: can you answer "to do what, exactly?" If not, the word is empty.

**11. No "most people" positioning.** Do not invoke an unnamed wrong crowd to make yourself look right. Not "what most people get wrong is…" or "everyone is focused on X, but the real story is Y". Keep "most people" only when a real, checkable observation backs it.

**12. No repeated post-to-post shapes.** A pattern that is fine inside one post becomes a tell when every post repeats it. [Structural Variety](#structural-variety) lists the shapes this corpus has worn out. Sameness across posts reads as machine output even when each post reads fine on its own.

---

## Figures (`rp-figure`)

A post draws a chart or an interactive widget by writing a fenced `rp-figure` block. The renderer expands it to HTML at load time; the post keeps only the data. Grammar and validation live in the figure parser (the module whose assertion messages start with `rp-figure:` — grep for that), the markup in the figure renderer beside it, the styles in the blog stylesheet (the only stylesheet in the directory that holds the post loader); `ls` that directory to see all three.

Read those three files for the current field lists before writing a figure — the summary below is the *why*, not the schema.

### The bar every figure has to clear

**A figure may only draw what its own post already states.** If you would have to invent a number, a duration, a price, or a behaviour to fill it, the post does not get a figure. Most posts do not get one, and that is the correct outcome — a feature announcement with no quantity and no comparison has nothing a chart carries better than the sentence.

Beyond that, a figure earns its place only by carrying one of:

- a comparison between two or more measured things,
- a magnitude the prose can only assert,
- or a rule the reader can probe, where the branches interact.

Stepping a reader through a chain they can already read whole is not one of these. Neither is re-enacting a UI the post describes.

Two rules follow from the first:

- A cell whose value the post never reports renders as *not reported*. Never fill it in to make a table look complete. Nothing stops you inventing a value here, so this one is on the author.
- A `budget` figure carries every step's counts explicitly rather than a formula, so no step can draw arithmetic the post does not support. The parser enforces this one.

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

The blog project ships no client bundle, and no figure may introduce one. Every interactive kind runs on native radio and checkbox inputs plus `:has()`, which is why keyboard and screen-reader behaviour come for free and why nothing here is subject to a jsdom-only test.

The `:has()` rules sit inside `@supports`, so each kind also has to read without them. That fallback is a design constraint, not a leftover: `walk` opens on its first stage, `matrix` shows the before column, `budget` shows its last step, `rule` shows the `else` branch. Each is an honest state on its own.

Two consequences for authors:

- The **first** option of a `choice` and the **last** `step` of a `budget` are what the figure loads with. Order them so the state it opens in is the one the post argues about.
- The selector lists in the stylesheet enumerate positions, so each kind has a ceiling (the step and `when` ceilings exported at the top of the parser). Raising one means extending the matching selector list.

### Colour

One meaning, across all five kinds: **brand amber is the behaviour that ships today** — the selected stage, the new rule, the cell the fix moved. Muted grey is the shape it replaced. The error colour token is only ever a failure. Amber never marks a wrong count.

Never hardcode a hex. The blog stylesheet is entirely token-driven so both themes come out right; a literal `#c8702a` renders light-mode amber on a dark page.

### Placing one

Put the figure directly after the paragraph it illustrates, with a blank line either side. Never inside the TL;DR disclosure block, and never before the first `##` heading. A post may carry more than one figure; input ids are numbered per post, so two figures never collide.

---

## Drafting a Post From Recent Commits

The standing workflow for turning shipped work into a post.

1. **Find the most recent published post and its `date`.**
2. **Gather the commits that landed on `main` after that date.** Summarise the user-facing changes and the technical improvements separately.
3. **Pick one topic** — the one that does most to make Readplace visible to the customers who matter for paid conversions, weighing both search and generative-engine discoverability. A product feature that matters to paying customers, or a technical detail that demonstrates a real advantage. One topic, one post.
4. **Run the [lookback](#the-lookback-do-this-before-writing-a-word)** before writing a word.
5. **Propose a [voice](#choosing-a-voice)** and confirm it before drafting.
6. **Draft**, following every rule in this file.
7. **Verify** against the checklist below.

If there are no meaningful commits since the last post, or no topic is suitable for external communication, say so briefly and suggest waiting for the next batch. A post with nothing to announce is worse than no post.

A post tagged `changelog` announces a shipped change to every reader of the product, so it must state plainly which problem it solves and what the reader gets. See [Title, description, and banner state the user benefit](#title-description-and-banner-state-the-user-benefit).

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
