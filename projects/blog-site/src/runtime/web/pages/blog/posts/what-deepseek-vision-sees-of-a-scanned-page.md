---
title: "What DeepSeek's Vision Model Actually Sees of a Scanned Page"
description: "DeepSeek shipped a vision model, so I checked whether it could read scanned PDFs better than the Tesseract pipeline Readplace runs today. The answer sat in their own documentation, published as running JavaScript rather than prose, and it also killed the one argument I had been making in favour of the upgrade."
slug: "what-deepseek-vision-sees-of-a-scanned-page"
date: "2026-08-22"
author: "Fayner Brack"
keywords: "deepseek vision, ocr, tesseract, hocr, scanned pdf, vision model, readplace, image tokens"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

DeepSeek shipped a vision model, and the obvious question was whether it could read scanned PDFs better than the Tesseract pipeline that handles them today. It cannot, for a reason the vendor publishes as running code rather than prose: every image is resized before inference, which puts a US Letter page at 76 dots per inch. Measuring that also killed the one argument I had been making for the upgrade, and pointed at layout data Tesseract had been computing all along and throwing away.

</div>
</details>

`new h(14, 3, 384, 4, 8, 147456)`

That constructor sits in a lazily-loaded JavaScript chunk behind DeepSeek's API documentation. It builds the image resize their vision model runs before inference, and it settled a question I had spent an afternoon arguing from the prose on the same page.

The question was whether to point a vision model at Readplace's scanned PDFs.

## What the pipeline does now

A scanned PDF has no text layer, so the pixels are all there is. [Readplace renders each page and runs Tesseract on it](/blog/readplace-now-reads-scans-in-15-languages) inside a Lambda container, then layers 3 DeepSeek text calls on top for error cleanup, cross-page diff review, and semantic HTML.

Pages render at 300 dots per inch. That number is not decoration. An A/B on the same 31-page scan moved the render from 150 to 300, and word recovery went from 21,335 to 23,719.

Tesseract's own documentation puts a floor under it: below an x-height of 10 pixels you have very little chance of accurate results, and below 8 pixels most of the text gets removed as noise.

So the first thing worth checking about a model that accepts images was how many pixels it keeps.

## The number the prose gives you

The [vision guide](/view/api-docs.deepseek.com/guides/vision/) says every image is resized so the total pixel count lands near that of an 800 by 800 image, with a ceiling of 384 tokens per image. It also offers a `detail` field whose `original` setting "keeps the original image", which reads like an escape hatch.

Both statements cannot be doing what they appear to do. I worked the arithmetic from the prose, got roughly 703 by 910 pixels for a Letter page, and called it 83 dots per inch. Close enough to be useful, wrong enough to matter.

## The hypothesis I liked

Reading letters at 83 dots per inch was not going to work. But I made a second argument I thought was stronger: layout is a low-frequency signal. Column edges, the gutter between them, a heading set 2 sizes above the body, the ruled line of a table. Coarse features survive downscaling even when glyphs turn to mush.

Readplace's 3rd DeepSeek stage infers document structure from text patterns alone, with no bounding boxes. Handing it a small picture of the page looked like the one honest use for a vision model here.

So I built a two-column Letter page, rendered it at 300, downscaled it to the resize target, and ran the same Tesseract invocation on both.

At 300 dots per inch the character error rate against known ground truth was 0.0 percent. At the downscaled size it was 63.9 percent.

Glyphs degraded, which I expected. Layout degraded worse. Heading detection went from 2 to 0, and the 2 columns fused line by line, so right-column text came back welded to left-column text in one line. `"Scale 1:50,000"` came back as `"Sel 1: $0000"`.

The signal I had called low-frequency was the first thing to go.

```rp-figure
kind: bars
title: What a Letter page loses going through the vision resize
note: Measured on a clean synthetic two-column page rendered at 300 dpi, then downscaled to the size DeepSeek's own resize algorithm produces. Character error rate is scored against known ground truth using the same Tesseract invocation on both images.
before: 300 dpi render
after: After the resize
row: Effective resolution | 300 | 300 dpi | 76 | 76 dpi
row: Character error rate | 0 | 0.0% | 63.9 | 63.9%
row: Headings detected | 2 | 2 of 2 | 0 | 0 of 2
row: Columns kept apart | 2 | 2 of 2 | 0 | fused
```

## The calculator was the documentation

The image token calculator on DeepSeek's page runs in the browser, which means the resize ships to anyone who loads the docs. I pulled the class out of the chunk and ran it.

A Letter page at 300 dots per inch comes back 644 by 826. That is 76 dots per inch, not the 83 I had computed, because the resize quantises to a patch grid instead of scaling by area. It costs 345 tokens rather than the 384 ceiling, and the word `detail` does not appear in the algorithm at all.

A page rendered at 150 dots per inch returns the same 644 by 826, so half the resolution the pipeline pays to produce would be discarded before the model looked at it.

## Small images go the other way

The last constant in that constructor is `minPixels`, and it points the other way. Images below the floor get scaled up.

A single line cropped from a page at 300 dots per inch, 1200 by 160 pixels, comes back 1204 by 168. Untouched, for 125 tokens. Crop tighter, to a phrase, and the model sees it at around 355 dots per inch, better than Tesseract gets.

The ceiling belongs to whole-page calls, not to the model. That leaves one version worth keeping: not reading a page, but adjudicating a single disputed word against its own pixels.

## The geometry was already on disk

Then I ran Tesseract with `hocr` instead of the plain-text writer, on the same 300 dpi render, and the argument collapsed for a different reason.

It reports an `x_size` per line: 74.27, 49.0, 38 and 30 for the 20pt, 13pt, 10pt and 8pt lines. Those ratios land within about 3 percent of the true font sizes, which maps onto heading levels directly. It marks the title `ocr_header`. It gives block boxes at x=[293,1199] and x=[1349,2256], the 2 columns, with the gutter measured to the pixel.

All of it on the same pass, at 300 dots per inch, for nothing. The pipeline asks for plain text and drops the rest.

I had been pricing a way to buy layout at 76 dots per inch, while the same page was handing me the answer at 300.

## Where the PDF pipeline stands

Nothing about scanned PDFs changed this week. Tesseract still does the reading and the 3 text stages still run on top.

What changed is that the upgrade came off the table for a reason I can point at, and the next thing to try is a flag on a command line rather than a new vendor. Save a scanned PDF to [your readlist](/) and it takes the path it took last month. I just know what the alternative would have cost, down to the pixel.
