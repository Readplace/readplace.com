---
title: "When Old Tools Beat Tokens, and When They Don't: Rebuilding Readplace's PDF OCR Pipeline"
description: "A scanned 1950s typewritten PDF broke Readplace's reader view. The fix took two architectures: an LLM-first pipeline that didn't work, a Tesseract pipeline that did, and the LLM-as-post-processor stages that ship today."
slug: "pdf-ocr-pipeline-tesseract-llm-hybrid"
date: "2026-05-27"
author: "Fayner Brack"
keywords: "pdf ocr, tesseract, llm, deepseek, reader view, readplace, scanned pdf, multilingual ocr, aws lambda"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Readplace renders scanned PDFs in its reader view by running Tesseract locally inside a Lambda container, then layering 3 DeepSeek calls on top. Those 3 calls do per-page error cleanup, document-level diff review, and per-page semantic HTML conversion for Readability.js parsing. The first version of the pipeline used a vision LLM as the OCR engine and broke on a 1950s CIA scan. Replacing it with Tesseract dropped wall clock from ~317 s to ~48 s, cost to $0, and lifted page success from 24/31 to 31/31. The LLM came back later, but for the work *after* recognition, which is the job classical OCR can't do.

</div>
</details>

A user saved a CIA reading-room PDF to Readplace. It was 31 pages of typewritten English from a 1950s issue of *Computers and Automation*, scanned and re-saved through Aspose. The reader view came back empty, and the article sat on `crawlStatus = failed` for days.

Fixing it took two distinct architectures. The first tried to make a vision LLM do OCR. The second threw the Google vision API out and used Tesseract, a tool first released in 1985, which finished the job in a tenth of the time, for zero dollars, and with no network call.

That was where I planned to end the story, on a line I liked: *old tools beat tokens*. The conclusion was tidy and it was also wrong on its own.

When I opened the reader view, it read like a wall of paragraphs. The magazine had a table of contents, numbered sections, columns, and sidebar callouts, and the reader saw none of that structure.

Tesseract had captured every word, but it handed me a flat stream. Fixing that meant reaching for an LLM again, used the right way this time, on a problem Tesseract was not built to touch.

What follows is the whole arc, in order: the mistakes, the metrics, the architecture that ships in [Readplace](https://readplace.com) today, and what I believe now about when to reach for which kind of tool.

## The problem: scanned PDFs in a reader app

Readplace is a privacy-first read-it-later app. People save articles, PDFs, and blog posts, and the app extracts the readable text and renders it in a clean reader view.

For a born-digital PDF with an embedded text layer, `pdftotext` does the job in milliseconds.

Scanned PDFs are a different animal. Books, archives, anything pre-2000s, anything that went through a copier on the way to disk has no text layer to extract.

The pixels are all you get.

The pipeline I started with looked like this:

1. `pdftoppm` renders one PNG per page.
2. Each PNG goes to a vision LLM (Google Gemma 4 vision on DeepInfra) with a prompt asking for structured HTML.
3. The combined HTML goes through Mozilla Readability to produce reader-shaped DOM.

It worked for clean scans, and it failed flat on the CIA PDF.

## Round 1: trying to make the vision LLM work

The vision model timed out on the dense pages. So I added a partial-success threshold that accepted the crawl when at least 80% of pages OCR'd, then a `pdftotext` fallback for the pages where the embedded text layer had survived the re-save, then per-page SDK budget tuning. After a few rounds the pipeline worked, in the sense that it worked for some PDFs some of the time:

- 24 of 31 pages via vision.
- 7 pages via the `pdftotext` fallback, wrapped in `<p class="ocr-text-layer">`.
- Wall clock ~317 s.
- About $0.02 per crawl in DeepInfra spend.
- DeepInfra's server-side cap at ~302 s capped the SDK timeout no matter what I set locally.

The pipeline shipped, but it was fragile.

Pages 22 to 25 of the CIA scan hit the cap on every run. Adding more retry headroom did nothing, because the cap lived upstream on the DeepInfra API side, out of my reach.

## Round 2: throw the vision model out

I tore out the entire vision model path and replaced it with `tesseract --psm 1 --oem 1 -l <languages> <png> -` running locally inside the same Lambda container.

There were no API calls, no network, no SDK retries, and no rate limits to negotiate.

Tesseract is a local LSTM-based OCR engine, originally built by HP Labs and open-sourced by Google in 2005. The codebase is older than I am.

The results on the same CIA PDF:

| Metric | DeepInfra (best round) | Tesseract |
|---|---:|---:|
| Orchestrator wall clock | 317 s | **48 s** |
| Pages via primary OCR | 24 of 31 | **31 of 31** |
| External API calls | 31 | **0** |
| Cost per crawl | ~$0.02 | **$0** |
| Deterministic | no | **yes** |

A follow-up A/B bumped the render DPI from 150 to 300, pinned `--oem 1` (the LSTM engine), and added Tesseract's script bundles (`tesseract-langpack-script_*` plus `tesseract-langpack-osd`) to the Lambda container. Word count rose from 21,335 to 23,719 on the same CIA PDF.

The per-chunk median went from 21 s to 35 s, and orchestrator wall clock from 48 s to 63 s. The bigger image cost nothing at runtime, because Tesseract mmaps tessdata lazily and only pages in the script a region actually recognises.

The problem in front of me had a name. *Optical character recognition of printed English text from the 1950s.* It is a 50-year-old computer vision problem, and Tesseract was literally built for it.

I had been using the vision LLM as a generic image-to-text tool. That does work, but it solves a much harder problem, open-ended visual reasoning, than the one I had, which was the plain task of recognising letters from pixels.

I had a hammer, and I had been reaching for it on reflex. The nail turned out to be a different shape.

## Going multilingual without a multilingual model

The next thing in front of me was a different shape of problem: *make this work for Chinese, Arabic, Japanese, Portuguese, and any other script, without language-specific rules.*

My instinct was to detect the language and route to a per-language model or config. The classical answer was simpler than that. Tesseract has a documented multi-script API for exactly this case.

- **Script bundles** under `<tessdata>/script/` each cover a script family in one model: `script/Latin` for Latin-script languages (Vietnamese has its own pack), `script/Arabic` for Arabic, Persian, and Urdu, `script/HanS` and `script/HanT` for Chinese, plus `script/Japanese`, `script/Hangul`, `script/Devanagari`, `script/Cyrillic`, `script/Greek`, `script/Hebrew`, `script/Thai`, `script/Tibetan`, and the rest. EPEL ships these as `tesseract-langpack-script_*`, around 35 packs instead of 100+ individual languages.
- **`--psm 1`** runs OSD (orientation plus script detection) before recognition, so Tesseract picks the right bundle per region.
- **`-l` accepts `script/<Name>` entries joined with `+`.** The canonical example in Tesseract's docs is `-l script/Devanagari`, and the grammar `LANG[+LANG]` permits combining bundles. Order matters for accuracy and speed, so passing every installed bundle is a trade-off rather than a free upgrade.

The wrapper enumerates the installed bundles at init time by reading `<tessdata>/script/`, prefixes each with `script/`, and joins them with `+` (`script/Arabic+script/Cyrillic+script/HanS+script/Latin+…`). One `tesseract` invocation per page then recognises any script present in the input.

There is no language detection step in the app code, no per-language branch, and no model selection step at all. Tesseract's own `--psm 1` handles the dispatch internally.

The vertical CJK variants (`HanS_vert`, `Hangul_vert`, `Japanese_vert`, `HanT_vert`) stay in the `-l` flag. OSD reports orientation per page, so a vertically-typeset book of Chinese poetry routes to the matching vertical model on its own, with no code change from me.

| Capability | DeepInfra | Tesseract (script bundles) |
|---|---|---|
| Pages via primary OCR | 24 of 31 | **31 of 31** |
| Writing systems recognisable without code changes | 1 (English) | **~35 scripts, covering 100+ languages** |
| Cost per crawl | ~$0.02 | **$0** |
| Deterministic | no | **yes** |

This was where I'd have stopped, with the same neat line: *old tools beat tokens*. With a hammer in hand you start seeing nails, and plenty of the things you hit are some other shape.

```rp-figure
kind: bars
title: What changed when Tesseract replaced the vision model
note: Timings and page counts are the Round 2 comparison on the CIA PDF; the ~35 scripts come from Tesseract's script bundles, added in a later A/B that also moved wall clock from 48 s to 63 s.
before: DeepInfra (best round)
after: Tesseract
row: Orchestrator wall clock | 317 | 317 s | 48 | 48 s
row: Pages via primary OCR | 24 | 24 of 31 | 31 | 31 of 31
row: External API calls | 31 | 31 | 0 | 0
row: Cost per crawl | 0.02 | ~$0.02 | 0 | $0
row: Writing systems recognisable without code changes | 1 | 1 (English) | 35 | ~35 scripts
```

## The sequel: the LLM came back, for the right job

The pipeline shipped to the staging environment, and it sat there OCR'ing PDFs deterministically with zero LLM calls.

Then I opened the CIA PDF in the reader view again, and it read like a wall of paragraphs.

That is a different problem from the one Tesseract handled. Tesseract is a character-recogniser. It returns words, and it cannot tell you which of those words are a heading and which are body text.

The font-size cues that separated a chapter title from a body line are gone the moment the page becomes plain text.

Residual error patterns survive too. There were cross-page hyphenations, like `Veposi-` at the end of one page and `tory` at the start of the next, and character substitutions like `V↔D` and `m↔rn` that slipped through because the misread happened to spell a real word.

These errors are *probabilistic*, and that is the shape of problem LLMs are good at.

So I reached for an LLM again. For the first time in this story, it was the right thing to reach for.

### Why this was the LLM's problem

The text Tesseract emitted was already readable. I was not asking the LLM to recognise letters from pixels this time. I was asking it to *edit* an already-recognised string, which is a much easier ask.

The cross-page corrections and the structural inference are fuzzy pattern matching against the surface form of text. A short all-caps line might be introducing the next paragraphs as an `<h2>`. A run of `1. ... 2. ... 3. ...` might be an ordered list. A column-aligned block might be a table.

Token-level classical rules catch some of these, but the brittle cases need judgment: numbered prefixes that are not lists, all-caps lines that are just acronyms.

Open-ended pattern-matching over text is what an LLM is good at, and letter recognition from pixels is what Tesseract is good at.

The Round 1 mistake was handing the LLM the letter recognition. The right call this round was handing it the work that comes after.

### The 3 new LLM stages

I switched the LLM from DeepInfra Gemma vision to **DeepSeek** chat completions. DeepSeek was already in use across Readplace for global TL;DR summaries, so there was no new vendor relationship to set up.

Pricing is favourable and latency is acceptable.

**Stage 1: per-page LLM cleanup.** This is a per-page fanout, one `chat.completions` call per page. The prompt asks the model to fix the obvious OCR errors and leave the rest of the text alone. It is conservative by construction. Change a word only when more than 90% confident, leave digits and proper nouns untouched, and drop only scanner-noise fragments. The structural guardrails sit inside the Lambda. Length-delta is capped at 30%, the digit multiset is preserved, and whitespace round-trips. On any rejection the original Tesseract text passes through unchanged. **Tesseract's output stays the safety net, and the LLM rides on top of it as a correction layer.**

**Stage 2: document diff review.** This is one `chat.completions` call per document. It sees the word-level diff between the original and the Stage 1 text for every page, plus the full cleaned text, and it emits APPROVE, REJECT, MODIFY, or NEW for each Stage 1 change with whole-document context. A `Harris → Hargis` fix that landed on one page out of 12 can be rejected once the original shows up correctly on the other 11. A per-span 50% length-delta cap sits in front of the document-level guardrails. On failure the page falls back to its Stage 1 text.

**Stage 3: per-page semantic HTML conversion.** This is another per-page fanout, one call per page, emitting a sanitised HTML5 fragment with `h2`, `h3`, `ul`, `ol`, `pre`, `code`, `blockquote`, `table`, `strong`, `em`, and `a[href]`. Text-pattern rules in the prompt stand in for the visual cues the old vision model relied on: numbered prefixes, all-caps short lines, pipe-separated columns, indent depths. Two guardrails per page check for empty output and for at least 70% visible-text retention. On rejection the page falls back to `<p class="ocr-tesseract">` paragraphs of the Stage 2 text.

Between each chunk fragment the orchestrator stitches in `<hr class="ocr-page-break">`. The reader iframe stylesheet renders that as a dotted, 60%-width centred rule that mimics a book-style section break. A document-level `sanitizeFragment` pass at the orchestrator stitches the per-page fragments together, closes any cross-page tag dangle, and re-applies an element and attribute allowlist over the stitched body. That is defence-in-depth on top of the per-page sanitisation that already runs inside each Stage 3 Lambda.

```rp-figure
kind: walk
title: Where a page lands when a stage's guardrail refuses its output
note: Tesseract's output stays the safety net, and the LLM rides on top of it as a correction layer.
toggle: Show the refusal path at each stage
step: Stage 1: per-page LLM cleanup | One DeepSeek chat.completions call per page is asked to fix the obvious OCR errors and leave the rest of the text alone, changing a word only when more than 90% confident and leaving digits and proper nouns untouched. | Length-delta is capped at 30%, the digit multiset is preserved, and whitespace round-trips; on any rejection the original Tesseract text passes through unchanged.
step: Stage 2: document diff review | One call per document reads the word-level diff between the original and the Stage 1 text for every page, plus the full cleaned text, and emits APPROVE, REJECT, MODIFY, or NEW for each Stage 1 change with whole-document context. | A per-span 50% length-delta cap sits in front of the document-level guardrails; on failure the page falls back to its Stage 1 text.
step: Stage 3: per-page semantic HTML conversion | Another per-page fanout, one call per page, emitting a sanitised HTML5 fragment with h2, h3, ul, ol, pre, code, blockquote, table, strong, em, and a[href]. | Two guardrails per page check for empty output and for at least 70% visible-text retention; on rejection the page falls back to p class="ocr-tesseract" paragraphs of the Stage 2 text.
step: Document-level sanitizeFragment | The orchestrator stitches the per-page fragments together, closes any cross-page tag dangle, and re-applies an element and attribute allowlist over the stitched body. | Elements and attributes outside the allowlist are dropped from the stitched body Mozilla Readability parses; that is defence-in-depth on top of the per-page sanitisation that already runs inside each Stage 3 Lambda.
```

### Infrastructure

There are 3 sync-invoked Lambdas, each sized to its stage:

| Lambda | Memory | Timeout |
|---|---:|---:|
| `pdf-page-llm-cleanup` | 512 MB | 300 s |
| `pdf-document-diff-review` | 1024 MB | 900 s |
| `pdf-page-html-convert` | 512 MB | 300 s |

The Tesseract Lambda itself stays at **1769 MB** of memory and a 900 s timeout.

On concurrency, the orchestrator fans out up to `MAX_PDF_PAGES` (300) Tesseract invocations and the same number of DeepSeek cleanup calls. AWS Lambda's account `ConcurrentExecutions` is 1000, so the orchestrator uses around 30% of it in the worst case.

I set the `LambdaClient` HTTPS-agent `maxSockets` to 400 to cover both fanouts plus retry headroom. The default of 50 would have queued invocations at the SDK layer with no error, capping effective concurrency well below the fan-out.

### What the LLM is not asked to do

- Read letters. Tesseract handles that.
- Detect tables as visual layout. The prompt operates on text patterns alone, without bounding boxes.
- Correct with anything less than high confidence. Each prompt rule and guardrail biases toward leaving content alone.
- Invent content at unanchored offsets. Stage 2 emits APPROVE, REJECT, MODIFY, or NEW. The NEW action can delete gibberish or substitute around an existing substring, but the anchor must already be in the page. Digits round-trip, and per-span length delta stays at or below 50%.

## The pipeline that ships in Readplace today

It runs on 6 components from 6 different eras:

| When | Tool | Job |
|---|---|---|
| **1985 / 2017** | Tesseract (`--psm 1 --oem 1`, every installed `script/*` bundle) | OCR, pixels to text across ~35 writing systems |
| **2024** | DeepSeek (Stage 1, per-page) | Conservative per-page error correction |
| **2024** | DeepSeek (Stage 2, document) | Cross-page diff review |
| **2024** | DeepSeek (Stage 3, per-page) | Semantic HTML structure |
| **~2014** | linkedom (`sanitizeFragment`) | Element and attribute allowlist on stitched body |
| **~2015** | Mozilla Readability | Reader-shaped DOM from stitched HTML |
| **~1996** | CSS in the reader iframe | Renders `<table>`, `<hr>`, and page breaks consistently |

That is 3 classical components, one LLM called 3 different ways, one sanitiser, and one reader stylesheet, each sized for the slice of the problem it owns.

The LLM stays out of letter recognition, Tesseract stays out of heading inference, and the CSS knows nothing about pages.

## What I think now

The first version of this story ended on *old tools beat tokens*. That conclusion held for the problem in front of me at the time, which was character recognition of scanned print, the thing I had been mis-using the LLM for.

Read as *no LLMs at all*, it stretches too far. The honest version is shorter.

**Classical tools beat tokens at the classical-tool job. LLMs beat classical tools at the LLM job. The hard part is knowing which job is in front of you.**

The first mistake showed the cost of reaching for the LLM hammer when the nail was OCR. The sequel showed the cost of *not* reaching for the LLM when the nail was probabilistic text correction and structural inference. Both costs were measurable, and both came from the same root error: wrong tool, right confidence.

So the updated lesson goes like this. Reach for the deterministic, narrow-purpose tool first when the problem is deterministic and narrow, and reach for the model when the problem is open-ended pattern-matching over text.

The expensive part is reading which mode the next sub-problem is in, and being willing to switch without letting your last decision harden into a tribal identity.

With a hammer in hand you start seeing nails, and a lot of what you hit is some other shape. Which things are nails keeps changing as you go.

Putting down a working tool when the next problem turns out different can cost you as much as forcing the wrong tool did the first time.

---

This is the OCR pipeline behind Readplace's reader view for scanned PDFs. The codebase is source-available on GitHub for you to see (in full). If you want a privacy-first read-it-later app that handles 1950s scanned magazines, born-digital PDFs, and modern blog posts in the same reader view without hallucinations, you can try it at [readplace.com](https://readplace.com).

## Further reading

- [Tesseract OCR on GitHub](https://github.com/tesseract-ocr/tesseract)
- [DeepSeek API documentation](https://api-docs.deepseek.com/)
- [Mozilla Readability on GitHub](https://github.com/mozilla/readability)
- [AWS Lambda container image support](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)
