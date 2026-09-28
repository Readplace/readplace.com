---
title: "The Save Popup Paints Before Its Own Code Loads"
description: "Clicking the toolbar button used to open an empty popup while the stylesheet, the font and the code loaded, at its worst on the first save after a browser restart. The popup's HTML now carries the save card's shape, the browser paints it before anything else loads, and CI fails any build whose cold open passes 107 milliseconds."
slug: "the-save-popup-paints-before-its-own-code-loads"
date: "2026-09-27"
author: "Fayner Brack"
keywords: "browser extension popup blank, extension popup slow to open, save articles instantly, instant save feedback, first paint, browser extension cold start, fastest way to save an article, read it later extension, pocket alternative, readplace"
tags: ["changelog"]
banner: "Saving from the toolbar no longer starts with a blank square"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

A click on the Readplace toolbar button now paints the save card's shape before the extension's stylesheet, font or application code loads. The slowest cold open measured across 240 fresh browser starts showed it in 85 milliseconds, and CI fails any build whose cold open passes 107 milliseconds in Chrome or 106 in Firefox. The card fills in as the save runs, and it holds its geometry when the real font arrives.

</div>
</details>

The slowest of 240 cold opens put the save card's shape on screen 85 milliseconds after the click. Those opens ran on 20 freshly started virtual machines with empty caches, first click of every session, which is the popup at its worst. The extension's stylesheet had not loaded when those pixels appeared, and neither had its font, its view markup, or the code that runs the save.

Feedback comes first now, and the machinery loads behind it.

## The blank square between click and code

A popup starts life as an empty window. The old order put pixels last: stylesheet, font, view markup, runtime, and only then something to look at. With the caches warm, that order finishes fast enough to pass for immediate. On the first open after a browser restart nothing is warm, and the click bought a blank square for as long as the loading took.

> **A click that changes nothing on screen reads as a click that did nothing.**

A toolbar click that seems to have missed invites a second click, and a second click on the same button closes the popup the first one was still opening.

## The card is in the HTML

The popup's HTML now opens on a grey silhouette of the save card: a circle for the icon, a pair of bars for the text, the outline of the action button, and a shorter bar for the keyboard hint. The styles that draw it are written into the page, and the colour tokens ride inline with them, dark palette included, so a system set to dark gets a dark skeleton rather than a white flash.

The only script present at that point is a small loader: 15 lines in Chrome, 31 in Firefox. In Chrome it subscribes to the browser's own [first-paint](/view/developer.mozilla.org/en-US/docs/Web/API/PerformancePaintTiming?utm_source=blog-the-save-popup-paints-before-its-own-code-loads&utm_medium=internal&utm_content=read-developer-mozilla-org) signal and requests the application stylesheet only after that signal says the skeleton is on screen. The runtime follows the stylesheet. Firefox reports paint differently, so its loader waits for the popup to hold native focus and gives the renderer a turn before fetching anything heavy.

That ordering is asserted, not assumed. The test instruments the old loader at the same boundaries and requires it to fail, then requires the new one to pass, once signed in and once signed out. Signed out, the silhouette resolves into the sign-in view instead of the card.

## The real font lands without moving the card

A skeleton makes a promise about geometry, and the loaded view has to keep it. Inter arrives after first paint, and a screenshot check caught the popup's list controls shrinking 2 pixels when it replaced the fallback font. Explicit 16-pixel line heights now hold the height through the swap, and the check fails by exactly those 2 pixels on the code without the fix. The card fills in where the silhouette stood, and [the save's step-by-step card](/blog/watch-your-article-save-step-by-step?utm_source=blog-the-save-popup-paints-before-its-own-code-loads&utm_medium=internal&utm_content=post-watch-your-article-save-step-by-step) plays out inside the same outline.

## 107 milliseconds or the build fails

The 85 milliseconds at the top of this post is a worst sample, and it was collected to set a gate rather than to brag. Across 20 hosted virtual machines, each browser's popup opened cold 120 times in total, half of the opens signed in and half signed out, with no warm-up clicks and no retried samples. Chrome's slowest open painted at 85.3 milliseconds, Firefox's at 84.5.

Each budget is that worst sample plus 25 percent, rounded up: 107 milliseconds for Chrome and 106 for Firefox. A change that pushes a cold open past its number fails CI before it reaches a toolbar. The samples don't support a budget under 100 milliseconds with that headroom, so the gates sit at 107 and 106 instead of a rounder claim.

TBH, a hosted virtual machine is not your laptop, and the number on your machine belongs to your machine. What travels is the order. The skeleton needs no network and no second file, so pixels come first wherever the popup runs.

## The worst case is now the demo

The change shows best exactly where popups look worst: the first save after the browser starts. [Install the extension](https://readplace.com/install) if it isn't in your toolbar, quit the browser fully, open it again, and save whatever tab you land on. The card's shape is waiting inside the popup before the save is, and the article it stands for ends up in [your readlist](/?utm_source=blog-the-save-popup-paints-before-its-own-code-loads&utm_medium=internal&utm_content=home).
