---
title: "Watch Your Article Save, Step by Step"
description: "Readplace's browser extension used to play a fake loading animation. Now the progress bar tracks the real save: it reads the page in your tab, then uploads it to Readplace, then fills to done. You see each step and know the save worked."
slug: "watch-your-article-save-step-by-step"
date: "2026-06-08"
author: "Fayner Brack"
keywords: "read it later, browser extension, save article, save progress, chrome extension, firefox extension, save articles browser extension, progress bar, readplace"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

The Readplace browser extension used to play a loading animation that ran on a fixed timer, which looked busy but tracked nothing about the real save. The bar now follows the actual work. It reads "Reading page…" for the step that pulls the page from your tab, then "Saving…" for the upload to Readplace, then snaps to done. Each step holds on screen long enough to read, in both Chrome and Firefox.

</div>
</details>

You click save in the extension. A bar slides across. A moment later your article sits in your readlist. For a long time that bar was a small lie. It ran on a fixed timer and filled to 90 percent on its own, whether or not the save had moved an inch, so a stalled save still looked healthy.

I replaced it with a bar that follows the real save, step by step.

## Two steps you can actually see

A save has two parts.

The extension first reads the current page out of your own browser tab, then it sends that page up to Readplace, and the bar shows both halves instead of papering over them with a single sweep.

Step one reads the page and the label says "Reading page…". Step two uploads those bytes and the label says "Saving…". When the save lands, the bar fills the rest of the way and the popup drops you back into your readlist.

That first step matters for more than a label, because the page comes through your own session and your own browser rather than a crawler hitting the site from a data centre, so pages that block automated fetchers still come through fine. The bar now names that step where it used to hide it.

## Fast saves no longer skip a step

A small page can read in under a millisecond, which means the two steps sometimes fire almost on top of each other. Drawn straight to the screen, "Reading page…" would flash past too fast to register and you would catch only "Saving…", as if the first step had not run at all.

So each step holds on screen for a short beat before the next one paints. A readlist keeps the steps in order so none of them gets dropped under load. You read "Reading page…", then "Saving…", then done, and that order holds whether your connection is fast or slow.

## Why a real bar beats a pretty one

A progress bar earns trust by telling the truth, and a bar that fills on a timer teaches you to ignore it. You watch it once, you notice it has no relationship to the save, and from then on you wait for the article to appear in your readlist instead.

A bar tied to the real save gives you something to act on. You watch the page get read, you watch it go up, and you can close the popup the second the save lands knowing it actually worked. If a save ever hangs, the bar stops where the trouble is rather than racing ahead to fake a finish.

This runs in both the Chrome and Firefox extensions, on every article you save from the toolbar.

Install the extension, open an article, and click save, then watch the bar read the page, send it, and finish. [Install the browser extension](https://readplace.com/install) or start at [readplace.com](/).
