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

Readplace renders scanned PDFs in its reader view by running Tesseract locally inside a Lambda container, then layering three DeepSeek calls on top — per-page error cleanup, document-level diff review, and per-page semantic HTML conversion for Readability.js parsing. The first version of the pipeline used a vision LLM as the OCR engine and broke on a 1950s CIA scan; replacing it with Tesseract dropped wall clock from ~317 s to ~48 s, cost to $0, and lifted page success from 24/31 to 31/31. The LLM cames back later, but for the work *after* recognition — exactly the job classical OCR can't do.

</div>
</details>

A user saved a CIA reading-room PDF to Readplace. Thirty-one pages of typewritten English from a 1950s issue of *Computers and Automation*, scanned and re-saved through Aspose. The reader view came back empty. The article sat on `crawlStatus = failed` for days.

Fixing it took two distinct architectures. The first tried to make a vision LLM do OCR. The second threw the Google vision API out and used Tesseract, a tool first released in 1985. Tesseract finished the job in a tenth of the time, for zero dollars, with no network call. That was where I planned to end the story. *Old tools beat tokens.* The conclusion was tidy. The conclusion was also wrong on its own.

I checked in the reader view and realised it read like a wall of paragraphs. The magazine had a table of contents, numbered sections, columns, and sidebar callouts. Tesseract captured every word, but the reader saw a flat stream. Fixing that needed an LLM again, used the right way this time, on a different problem.

What follows is the whole arc: the mistakes, the metrics, the architecture that ships in [Readplace](https://readplace.com) today, and what I now believe about when to reach for which kind of tool.

## The problem: scanned PDFs in a reader app

Readplace is a privacy-first read-it-later app. People save articles, PDFs, and blog posts. The app extracts the readable text and renders it in a clean reader view. For born-digital PDFs with an embedded text layer, `pdftotext` does the job in milliseconds.

Scanned PDFs are different. Books, archives, anything pre-2000s, anything that went through a copier on the way to disk has no text layer to extract. The pixels are all there is.

The pipeline I started with looked like this:

1. `pdftoppm` renders one PNG per page.
2. Each PNG goes to a vision LLM (Google Gemma 4 vision on DeepInfra) with a prompt asking for structured HTML.
3. The combined HTML goes through Mozilla Readability to produce reader-shaped DOM.

It worked for clean scans. It failed for the CIA PDF.

## Round 1: trying to make the vision LLM work

The vision model timed out on dense pages. I added a partial-success threshold (accept the crawl if ≥80% of pages OCR'd), then a `pdftotext` fallback for pages where the embedded text layer survived PDF's re-save, then per-page SDK budget tuning. After several rounds, the pipeline worked, sort of, for some PDFs, some of the time:

- 24 of 31 pages via vision.
- 7 pages via the `pdftotext` fallback, wrapped in `<p class="ocr-text-layer">`.
- Wall clock ~317 s.
- About $0.02 per crawl in DeepInfra spend.
- DeepInfra's server-side cap at ~302 s capped the SDK timeout no matter what I set locally.

The pipeline shipped but it was fragile. Pages 22 to 25 of the CIA scan hit the cap on every run. Adding more retry headroom didn't help — the cap was upstream on DeepInfra API side.

## Round 2: throw the vision model out

I replaced the entire vision model path with `tesseract --psm 1 --oem 1 -l <languages> <png> -` running locally inside the same Lambda container.

There are no API calls, no network, no SDK retries, no rate limits to negotiate. Tesseract is a local LSTM-based OCR engine, originally built by HP Labs and open-sourced by Google in 2005. The codebase is older than me.

The results on the same CIA PDF:

| Metric | DeepInfra (best round) | Tesseract |
|---|---:|---:|
| Orchestrator wall clock | 317 s | **48 s** |
| Pages via primary OCR | 24 of 31 | **31 of 31** |
| External API calls | 31 | **0** |
| Cost per crawl | ~$0.02 | **$0** |
| Deterministic | no | **yes** |

A follow-up A/B bumped the render DPI from 150 to 300, pinned `--oem 1` (the LSTM engine), and added Tesseract's script bundles (`tesseract-langpack-script_*` + `tesseract-langpack-osd`) to the Lambda container. Word count rose from 21,335 to 23,719 on the same CIA PDF. Per-chunk median went from 21 s to 35 s; orchestrator wall clock from 48 s to 63 s. The image-size hit was free at runtime because Tesseract mmaps tessdata lazily — only the script a region recognises is paged in.

The actual problem here had a name. *Optical character recognition of printed English text from the 1950s.* It is a fifty-year-old computer vision problem. Tesseract was literally built for it. I had been using the vision LLM as a generic image-to-text tool, which works, but solves a much harder problem (open-ended visual reasoning) than the one I had (recognise letters from pixels).

I had a hammer, and I had been reaching for it. The nail turned out to be a different shape.

## Going multilingual without a multilingual model

Now there was this challenge: *make this work for Chinese, Arabic, Japanese, Portuguese, and any other script, without language-specific rules.*

The instinct was to detect language and route to a per-language model/config. The classical answer was simpler — Tesseract has a documented multi-script API for exactly this case.

- **Script bundles** under `<tessdata>/script/` each cover a script family in one model: `script/Latin` for Latin-script languages (Vietnamese has its own pack), `script/Arabic` for Arabic/Persian/Urdu, `script/HanS` and `script/HanT` for Chinese, plus `script/Japanese`, `script/Hangul`, `script/Devanagari`, `script/Cyrillic`, `script/Greek`, `script/Hebrew`, `script/Thai`, `script/Tibetan`, and the rest. EPEL ships these as `tesseract-langpack-script_*` — ~35 packs instead of 100+ individual languages.
- **`--psm 1`** runs OSD (orientation + script detection) before recognition, so Tesseract picks the right bundle per region.
- **`-l` accepts `script/<Name>` entries joined with `+`.** The canonical example in Tesseract's docs is `-l script/Devanagari`; the grammar `LANG[+LANG]` permits combining bundles. Order matters for accuracy and speed, so passing every installed bundle is a trade-off, not a free upgrade.

The wrapper enumerates the installed bundles at init time by reading `<tessdata>/script/`, prefixes each with `script/`, and joins them with `+` (`script/Arabic+script/Cyrillic+script/HanS+script/Latin+…`). One `tesseract` invocation per page recognises any script present in the input. There is no language detection step in the app code, no per-language branch, and no model selection step. Tesseract's own `--psm 1` handles the dispatch internally.

The vertical CJK variants (`HanS_vert`, `Hangul_vert`, `Japanese_vert`, `HanT_vert`) stay in the `-l` flag. OSD reports orientation per page, so a vertically-typeset book of Chinese poetry routes to the matching vertical model without a code change.

| Capability | DeepInfra | Tesseract (script bundles) |
|---|---|---|
| Pages via primary OCR | 24 of 31 | **31 of 31** |
| Writing systems recognisable without code changes | 1 (English) | **~35 scripts, covering 100+ languages** |
| Cost per crawl | ~$0.02 | **$0** |
| Deterministic | no | **yes** |

This was where I'd have stopped. *Old tools beat tokens.* With a hammer in hand, problems start to look like nails, and most problems are not nails (or a different kind).

## The sequel: the LLM came back, for the right job

The pipeline shipped to staging. It sat there OCR'ing PDFs deterministically with zero LLM calls. Then I opened opened the CIA PDF in the reader view again and it read like a wall of paragraphs.

This is a different problem than the one Tesseract handled. Tesseract is a character-recogniser. It returns words. It cannot tell you which words are a heading and which are body text. The font-size cues that distinguished a chapter title from a body line are lost the moment the page becomes plain text.

Residual error patterns also survive. Cross-page hyphenations like `Veposi-` on one page and `tory` on the next. Character substitutions like `V↔D` and `m↔rn` that survived because the misread looked like a real word. These errors are *probabilistic*. They are the shape of problem LLMs are good at.

I reached for an LLM again. For the first time in this story, it was the right thing to reach for.

### Why this was the LLM's problem

The text Tesseract emitted was already readable. I was not asking the LLM to recognise letters from pixels. I was asking it to *edit* an already-recognised string.

The cross-page corrections and the structural inference are fuzzy pattern matching against the surface form of text. A short ALL-CAPS line might introduce the next paragraphs as an `<h2>`. A run of `1. ... 2. ... 3. ...` might be an ordered list. A column-aligned block might be a table. Token-level classical rules handle some of these, but the brittle cases (numbered prefixes that are not lists, ALL-CAPS lines that are just acronyms) need judgment.

Open-ended pattern-matching over text is the LLM's strength. Letter recognition from pixels is Tesseract's. The Round 1 mistake was using the LLM for letter recognition. The right call this round was using it for the work after letter recognition.

### The three new LLM stages

I switched the LLM from DeepInfra Gemma vision to **DeepSeek** chat completions. DeepSeek was already in use across Readplace for global TL;DR summaries, so no new vendor relationship was required. Pricing is favourable and latency is acceptable.

**Stage 1: per-page LLM cleanup.** Per-page fanout, one `chat.completions` call per page. The prompt asks the model to fix obvious OCR errors and preserve the rest of the text. Conservative by construction: change a word only when more than 90% confident, leave digits and proper nouns alone, drop only scanner-noise fragments. Structural guardrails sit inside the Lambda. Length-delta is capped at 30%, the digit multiset is preserved, and whitespace round-trips. On any rejection, the original Tesseract text passes through unchanged. **Tesseract's output remains the safety net. The LLM acts as an optimisation layer on top.**

**Stage 2: document diff review.** One `chat.completions` call per document. It sees the word-level diff between original and Stage 1 text for every page, plus the full cleaned text. It emits APPROVE, REJECT, MODIFY, or NEW for each Stage 1 change with whole-document context. A `Harris → Hargis` fix that landed on one page out of twelve can be rejected when the original appears correctly on eleven other pages. A per-span 50% length-delta cap sits in front of the document-level guardrails. On failure the page falls back to Stage 1 text.

**Stage 3: per-page semantic HTML conversion.** Per-page fanout, one call per page, emits a sanitised HTML5 fragment with `h2`, `h3`, `ul`, `ol`, `pre`, `code`, `blockquote`, `table`, `strong`, `em`, and `a[href]`. Text-pattern rules in the prompt replace the visual cues the vision model used to use — numbered prefixes, all-caps short lines, pipe-separated columns, indent depths. Two guardrails per page check for empty output and at least 70% visible-text retention. On rejection, the page falls back to `<p class="ocr-tesseract">` paragraphs of the Stage 2 text.

Between each chunk fragment the orchestrator stitches in `<hr class="ocr-page-break">`. The reader iframe stylesheet renders it as a dotted 60%-width centred rule, mimicking a book-style section break. A document-level `sanitizeFragment` pass at the orchestrator stitches per-page fragments together, closes any cross-page tag dangle, and re-applies an element and attribute allowlist over the stitched body. This is defence-in-depth on top of the per-page sanitisation that runs inside each Stage 3 Lambda.

### Infrastructure

Three sync-invoked Lambdas, sized to their stage:

| Lambda | Memory | Timeout |
|---|---:|---:|
| `pdf-page-llm-cleanup` | 512 MB | 300 s |
| `pdf-document-diff-review` | 1024 MB | 900 s |
| `pdf-page-html-convert` | 512 MB | 300 s |

The Tesseract Lambda itself stays at **1769 MB** of memory and a 900 s timeout.

Concurrency: the orchestrator fans out up to `MAX_PDF_PAGES` (300) Tesseract invocations and the same number of DeepSeek cleanup calls. AWS Lambda's account `ConcurrentExecutions` is 1000, so the orchestrator uses ~30% in the worst case. The `LambdaClient` HTTPS-agent `maxSockets` is set to 400 to cover both fanouts plus retry headroom — the default 50 would silently queue invocations at the SDK layer and cap effective concurrency well below the fan-out.

### What the LLM is not asked to do

- Read letters. Tesseract handles that.
- Detect tables as visual layout. The prompt operates on text patterns alone, without bounding boxes.
- Correct with anything less than high confidence. Each prompt rule and guardrail biases toward leaving content alone.
- Invent content at unanchored offsets. Stage 2 emits APPROVE / REJECT / MODIFY / NEW; NEW can delete gibberish or substitute around an existing substring, but the anchor must already be in the page. Digits round-trip; per-span length delta ≤ 50%.

## The pipeline that ships in Readplace today

Six components from six different eras:

| When | Tool | Job |
|---|---|---|
| **1985 / 2017** | Tesseract (`--psm 1 --oem 1`, every installed `script/*` bundle) | OCR, pixels to text across ~35 writing systems |
| **2024** | DeepSeek (Stage 1, per-page) | Conservative per-page error correction |
| **2024** | DeepSeek (Stage 2, document) | Cross-page diff review |
| **2024** | DeepSeek (Stage 3, per-page) | Semantic HTML structure |
| **~2014** | linkedom (`sanitizeFragment`) | Element and attribute allowlist on stitched body |
| **~2015** | Mozilla Readability | Reader-shaped DOM from stitched HTML |
| **~1996** | CSS in the reader iframe | Renders `<table>`, `<hr>`, and page breaks consistently |

Three classical components, one LLM called three different ways, one sanitiser, and one reader stylesheet. Each component is sized for the slice of the problem it owns. The LLM stays out of letter recognition, Tesseract stays out of heading inference, and the CSS knows nothing about pages.

## What I think now

The first version of this story ended on *old tools beat tokens*. That conclusion is correct for the problem at hand at the time: character recognition of scanned print, the thing I had been mis-using the LLM for. It generalises too far if read as *no LLMs*. The honest version is shorter.

**Classical tools beat tokens at the classical-tool job. LLMs beat classical tools at the LLM job. The hard part is knowing which job is which.**

The original mistake showed the cost of reaching for the LLM hammer when the nail was OCR. The sequel showed the cost of *not* reaching for the LLM when the nail was probabilistic text correction and structural inference. Both costs were measurable, and both came from the same root mistake: wrong tool, right confidence.

The lesson, updated: reach for the deterministic, narrow-purpose tool first when the problem is deterministic and narrow. Reach for the model when the problem is open-ended pattern-matching over text. The expensive part is recognising which mode the next sub-problem is in, and being willing to switch between modes without your previous decision turning into a tribal identity.

With a hammer in hand, problems start to look like nails, and most problems are not nails. The things that *are* nails change as you go. Pulling out a working tool when the next problem looks like a different one costs as much as forcing the wrong tool the first time.

---

This is the OCR pipeline behind Readplace's reader view for scanned PDFs. The codebase is source-available on GitHub for you to see (in full). If you want a privacy-first read-it-later app that handles 1950s scanned magazines, born-digital PDFs, and modern blog posts in the same reader view without hallucinations, you can try it at [readplace.com](https://readplace.com).

## Further reading

- [Tesseract OCR on GitHub](https://github.com/tesseract-ocr/tesseract)
- [DeepSeek API documentation](https://api-docs.deepseek.com/)
- [Mozilla Readability on GitHub](https://github.com/mozilla/readability)
- [AWS Lambda container image support](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)
