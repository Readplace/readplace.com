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

Put the figure directly after the paragraph it illustrates, with a blank line either side. Never in `tldr:`, and never before the first `##` heading. A post may carry more than one figure; input ids are numbered per post, so two figures never collide.
