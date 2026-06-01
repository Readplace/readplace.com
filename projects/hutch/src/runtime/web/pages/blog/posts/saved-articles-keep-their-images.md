---
title: "Your Saved Articles Keep Their Pictures"
description: "Most read-it-later apps store the text and link the photos back to the source site, so they break when the site changes. Readplace saves a copy of every image on its own CDN. A recent fix makes sure each photo in a multi-image article gets saved, at every screen size."
slug: "saved-articles-keep-their-images"
date: "2026-06-01"
author: "Fayner Brack"
keywords: "read it later, save article images, offline reading, broken images, image preservation, responsive images, srcset, save web page, readplace"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Readplace saves a copy of an article's images on its own CDN, so your saved copy keeps its pictures after the source site changes. A recent fix makes sure each photo in a multi-image article gets saved, at every screen size, not just the first few. A second fix keeps the fresh images when an article gets re-checked and its pictures changed.

</div>
</details>

You save a long feature with a dozen photos. Two weeks later you open it on your phone. Every picture loads, sharp and at the right size. The original site has redesigned and dropped half those images, but your saved copy still has them.

That is the promise of a read-it-later app. You save now, you read later, and what you saved stays put. Plenty of apps break that promise with images. They store the text and point the pictures straight back to the source site. The day the site moves or deletes a file, your saved copy shows a gray box.

Readplace works differently. Save a page and it downloads the images and stores them on its own CDN. Your reader loads pictures from Readplace, not from the source. The article keeps its look after the original changes.

## The bug I found in multi-image articles

Modern sites ship each photo at several sizes. Your browser picks the right one for your screen through the `srcset` attribute. One photo can carry six or eight versions, one per width.

Readplace saves up to twenty photos per article, so a single save stays fast and small. The old limit counted files, not photos. A single photo with eight versions ate eight slots. A gallery near the top of an article could use up the whole budget on its own. Later photos got nothing.

Two bad things followed. A photo with no saved copy fell back to a neighbour's image, so you saw the wrong picture. Or it pointed at the source site, and that link broke the day the site changed.

## The fix: count photos instead of files

I changed the limit to count distinct photos. Readplace groups every version of one photo together, then saves whole photos up to the budget. Each photo it keeps gets all its sizes, so your screen has the right one to load. No photo is left half-saved, so the wrong-image fallback no longer fires for a photo we kept.

I added a second guard for re-saves. Readplace re-checks saved articles over time. Sometimes the text reads the same but the site swapped the images. The old check saw matching text and kept the stale copy. Now Readplace compares the image URLs too. If the pictures changed, it keeps the fresh version with the current images.

## What this means for you

Save a photo-heavy piece and trust the photos to be there later. A recipe with step-by-step shots, a travel diary, a design teardown, a research paper full of figures. The images load from Readplace at the size your screen wants, and they hold up after the source site moves on.

Try it with the next article you mean to read. Paste the link into your queue, open it tomorrow, and check the pictures. Start saving at [readplace.com](/).
