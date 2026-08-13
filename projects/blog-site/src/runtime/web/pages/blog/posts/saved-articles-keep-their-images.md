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

I saved a long photo feature, opened it on my phone the next morning, and a picture halfway down was the wrong one. Not a gray box where an image used to be, but a close-up of a sauce pan sitting where a wide kitchen shot should have been. The photos further down were broken gray boxes.

That is the kind of thing a read-it-later app is supposed to make impossible. You save now, you read later, and what you saved stays put. Plenty of apps store only the text and point the images back at the source site, so the day that site moves a file you get a gray box. Readplace downloads the images and stores them on its own copy host, so your reader loads pictures from us and not from the source. The wrong picture meant something in our own pipeline had gone sideways.

> **The article kept its text, but it served someone else's photo in the middle of mine.**

## Tracing the wrong picture

The first thing I checked was the saved copy in the database. The text matched the source. The image references did not.

Modern sites ship each photo at several widths, and the browser picks one through the `srcset` attribute. A single photo can carry 6 or 8 versions, one per screen size.

That detail turned out to be the whole bug.

Readplace caps a save at 20 photos per article so the save stays fast and the stored copy stays small. The old code counted files, not photos. One photo with 8 versions ate 8 slots.

A gallery near the top of a long feature could spend the entire budget before the saver ever reached the body of the piece.

So the later photos in my feature got no saved copy at all. When the reader could not find a stored image for a slot, it fell back to the nearest one it did have, which is how I ended up staring at a sauce pan.

The photos past that point had no fallback to grab, so they pointed back at the source and broke when the site changed.

## Counting photos instead of files

The fix was to change what the limit counts.

Readplace now groups every version of one photo together and spends the budget on whole photos, so each photo it keeps comes with all of its widths and the reader has the right size to load.

```rp-figure
kind: budget
title: The same 20-slot cap, spent on files or on whole photos
note: The cap did not move. What it counted is what emptied it early.
input: Widths one photo ships in its srcset
oldLabel: Old rule · the budget counted files
newLabel: New rule · the budget counts whole photos
unit: whole photos kept with all their widths
step: 6 | 3 | 20
step: 8 | 2 | 20
```

No photo gets left half-saved, which is what killed the wrong-image fallback for anything we chose to keep.

Then I found a second hole while testing the first fix. Readplace re-checks saved articles over time, and sometimes the text reads the same on a re-check while the site has swapped the images underneath it. The old comparison saw matching text and kept the stale copy, so a re-save could drop a corrected set of pictures without me noticing.

I made it compare the image URLs as well, and when the pictures have changed it keeps the version with the current images.

## What this means for you

Save a photo-heavy piece and the photos hold up. A recipe with step-by-step shots, a travel diary, a design teardown, a research paper full of figures all keep their images, loaded from Readplace at the size your screen wants, even after the source site redesigns and drops half of them.

The lesson I took from this one is small but it cost me a morning: when you cap a resource, count the thing the user cares about, not the file that happens to represent it. A photo is one thing to a reader even when it is 8 files to a browser.

Try it with the next article you mean to read. Paste the link into your queue, open it tomorrow, and check the pictures. Start saving at [readplace.com](/).
