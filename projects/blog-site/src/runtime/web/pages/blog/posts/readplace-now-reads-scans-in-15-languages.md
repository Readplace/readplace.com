---
title: "Readplace Now Reads Scans in 15 Languages"
description: "Save a scanned page in Hindi, Chinese or Arabic and Readplace used to return gibberish and call it a successful save. It now reads 15 languages from a scan, each one measured against a real page. A post here in May claimed 100+ and nobody had checked."
slug: "readplace-now-reads-scans-in-15-languages"
date: "2026-08-23"
author: "Fayner Brack"
keywords: "ocr, scanned pdf, hindi ocr, chinese ocr, arabic ocr, japanese ocr, multilingual reader, readplace"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Save a scanned page in Hindi, Chinese, Arabic or 11 other languages and Readplace used to hand back gibberish, then record the save as successful. It now reads 15 languages from a scan, each one checked against a real degraded page. A post here in May said 100+ languages worked. That was 3 months of a claim nobody had tested.

</div>
</details>

```
TELA E MEN E ALL
Hy ARMER ZEA M FA
```

That is what Readplace gave a reader who saved a scanned Chinese page. It was 737 characters long, so nothing downstream noticed anything was wrong. The article went into the queue looking saved.

## The 15 that work

Each of these was checked against a real scanned page, degraded to look like it came off a photocopier, and run through the whole pipeline:

**Chinese, Japanese, Korean, Hindi, Arabic, Hebrew, Russian, Greek, Thai, Bengali, Tamil, Telugu, Kannada, Malayalam, and English.**

English already worked. The other 14 returned gibberish until this week.

Some of those recover better than others. Chinese, Hindi, Russian, Greek and Hebrew came back with every character class intact. Arabic reached 93%, Malayalam 94%, Korean 78%. Korean sits lowest because it has thousands of distinct syllable blocks and a single test page can only show so many of them.

```rp-figure
kind: bars
title: Characters recovered from a scanned page, before and after
note: Fraction of the source page's distinct characters that survived OCR, measured on one degraded single-page scan per language. 1.00 means every character class was read back.
before: Before
after: After
row: Chinese | 0 | 0.00 | 1 | 1.00
row: Hindi | 0 | 0.00 | 1 | 1.00
row: Russian | 0.05 | 0.05 | 1 | 1.00
row: Arabic | 0 | 0.00 | 0.93 | 0.93
row: Japanese | 0 | 0.00 | 1 | 1.00
row: Korean | 0.02 | 0.02 | 0.78 | 0.78
row: Languages readable | 1 | 1 of 15 | 15 | 15 of 15
```

## Why 15 and not 500

The recogniser does not have a model per language. It has one per alphabet.

That works in your favour more often than not. The model that reads Russian is really a Cyrillic model, so Ukrainian, Bulgarian, Serbian and Kazakh go through the same file. The Arabic one also covers Persian and Urdu. The Hindi one covers Marathi and Nepali. English has been sharing its model with Spanish, German, Portuguese, Turkish and Vietnamese since long before this change.

So the honest number is 15 languages tested and a larger number that should follow from them. I am naming the 15 because those are the ones I put a page through. The rest is an inference, and inference is how the last claim went wrong.

## The claim that sat here for 3 months

A post on this blog said Readplace read scanned PDFs in about 35 writing systems, covering 100+ languages. I have taken that post down rather than patch the sentence, and this one replaces it.

It went out on 27 May. On 28 May a performance fix cut the recogniser down to one alphabet, because loading every model at once had pushed a single page to 313 seconds and was timing out. The fix was right. The sentence above it stayed up anyway.

Nothing caught it, and the reason is the gibberish at the top of this post. A page read with the wrong alphabet does not throw an error. It returns a plausible number of characters, clears the pipeline's success threshold, and gets tidied up by 3 language-model stages that spend real tokens making noise look neat.

On one test page the cleanup stage actually worked out what was happening and replied "The provided text appears to be garbled or corrupted". That sentence became the article body.

> **A capability nobody tested is a claim, not a feature.**

## What it costs you

The recogniser now spends about half a second per page working out which alphabet it is looking at before it reads anything.

On a 31-page scanned magazine the crawl went from 100 to 120 seconds. On a 212-page book it went from 214 to 227, which is under 6%, because a fixed per-page cost matters less the longer the document runs. A 13-page PDF moved by under 1%.

The crawl runs after the save, so the card still appears the moment you save the link. What moved is how long until the text is ready underneath it.

## The part that keeps this honest

There is now one scanned page committed for each of the 15 languages, and a test that reads every one and checks the text comes back in its own alphabet rather than transliterated into ours.

Run that test against last week's code and it fails on 14 of the 15. It spends no AI tokens, because working out which alphabet is on a page is not a job for a language model.

Some languages still do not work. Georgian, Armenian, Khmer, Amharic and about 18 others get misidentified before anything reads them, and they return the same gibberish this post opened with. They are not on the list above, and they will not be until a page proves otherwise.
