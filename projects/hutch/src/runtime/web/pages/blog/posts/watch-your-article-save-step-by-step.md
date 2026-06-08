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

The Readplace browser extension used to play a loading animation that ran on a timer. It looked busy, but the bar had nothing to do with the real save. The bar now tracks the actual work. It reads "Reading page…" for the step that pulls the page from your tab, then "Saving…" for the upload to Readplace, then snaps to done. Each step stays on screen long enough to read. This runs in both Chrome and Firefox.

</div>
</details>

You click save in the extension. A bar slides across. A moment later your article sits in your queue. For a long time that bar was a small lie. It animated on a fixed timer and filled to ninety percent on its own, whether or not the save had moved an inch. If a save stalled, the bar still looked happy.

We replaced it. The bar now follows the real save, step by step.

## Two steps you can actually see

A save has two parts. First the extension reads the current page from your own browser tab. Then it sends that page up to Readplace.

The bar shows both. Step one reads the page, and the label reads "Reading page…". Step two uploads those bytes to Readplace, and the label reads "Saving…". The save lands, the bar fills the rest of the way, and the popup shows your queue.

Reading the page from your own tab matters for more than the label. The page comes through your session and your real browser, so sites that block crawlers still let it through. The bar now names that step out loud.

## Fast saves no longer skip a step

A small page reads in under a millisecond. The two steps can fire almost on top of each other. Drawn straight to the screen, "Reading page…" would flash past too fast to read, and you would see only "Saving…".

So each step holds on screen for a short beat, then the next one paints. A queue keeps the steps in order, so none gets dropped. You read "Reading page…", then "Saving…", then done. The order is the same on a fast connection or a slow one.

## Why a real bar beats a pretty one

A progress bar earns trust by telling the truth. A bar that fills on a timer teaches you to ignore it. You learn it means nothing, so you stop reading it and wait for the queue instead.

A bar tied to the real save gives you something to act on. You see the page get read. You see it go up. You can close the popup the moment the save lands, sure that it worked. If a save ever hangs, the bar stops where the trouble is and does not race ahead to pretend.

This runs in both the Chrome and Firefox extensions, on every article you save from the toolbar.

Install the extension, open an article, and click save. Watch the bar read the page, then save it, then finish. [Install the browser extension](https://readplace.com/install) or start at [readplace.com](/).
