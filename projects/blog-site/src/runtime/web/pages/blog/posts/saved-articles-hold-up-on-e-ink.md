---
title: "Saved Articles That Hold Up on an E-ink Screen"
description: "11 pairs of ink and background across the Readplace reader and readlist sat under their WCAG contrast floor, with article links rendering fainter than the prose around them. All 11 now clear it, thumbnails and the logout menu work with scripting off, and 3 test suites measure both pages the way an e-ink panel sees them."
slug: "saved-articles-hold-up-on-e-ink"
date: "2026-08-22"
author: "Fayner Brack"
keywords: "read articles on e-ink, e-reader browser reading app, wcag contrast reading app, greyscale reading, read it later without javascript, high contrast reader, accessible read it later, link contrast, faint text low contrast fix, pocket alternative e-reader"
tags: ["changelog"]
banner: "I made the reader hold up on an e-ink screen"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

An e-reader's built-in browser keeps 16 shades of grey, fires no hover, and often runs no script. Measured under those conditions, Readplace came up short in 11 places: article links fainter than the prose around them, a Mark as read button at 2.95:1 in dark mode, thumbnails a scriptless browser would show as a blank strip, and a menu that kept the logout link out of reach without JavaScript. All 11 are fixed, the worst of them by darkening the one amber button the whole product leans on, and 3 test suites now measure contrast, greyscale ink, and script-free reading on each build.

</div>
</details>

Amber is the colour Readplace signs itself with, and it was painting the links in an article fainter than the prose around them. Against white that amber lands at 3.62:1, under the 4.5:1 [WCAG floor](/view/www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html?utm_source=blog-saved-articles-hold-up-on-e-ink&utm_medium=internal&utm_content=read-www-w3-org) for body-size text, and it was serving as link ink across [the reader](/blog/read-any-article-clean-reader?utm_source=blog-saved-articles-hold-up-on-e-ink&utm_medium=internal&utm_content=post-read-any-article-clean-reader) and the readlist. I only found this because I stopped trusting my own screen: this month I walked every rendered element on both pages, in both themes, and measured each pair of ink and background against its floor. 11 pairs came back under it. 8 were that one amber.

> **A link that renders fainter than the words around it inverts what a link is for.**

## A darker amber was already there

The palette held a second amber for text all along, at 5.06:1 in the light theme and 6.34:1 in the dark one. The 8 offenders moved onto it. In dark mode the 2 tokens resolve to the same value, so only light-mode pixels changed.

The 2 filled amber buttons were in worse shape. Mark as read in the reader measured 3.62:1 in light and 2.95:1 in dark, under even the 3:1 line WCAG grants large text, and the call to action on a failed crawl repeated the same numbers. Both lightened on hover with a brightness filter, a move the brand guidelines ban outright. A solid amber fill leaves no way out here: white ink needs a darker fill under it, and nothing darker existed for the hover to become. Both buttons took the outlined look the readlist's own Mark as read already wore, where rest and hover each clear 5.06:1.

## Grey does its own arithmetic

An e-ink panel keeps 16 greys and drops the hue on arrival. A colour that differs from its background mostly in hue reads fine on a laptop and fades out on the panel, so the audit's second pass measured with the colour stripped.

The stripping is where it got strange. CSS [`grayscale(1)`](/view/developer.mozilla.org/en-US/docs/Web/CSS/filter-function/grayscale?utm_source=blog-saved-articles-hold-up-on-e-ink&utm_medium=internal&utm_content=read-developer-mozilla-org) works on the gamma-encoded channels, while WCAG's luminance formula works on the linearised ones, and the 2 disagree by as much as 0.7:1 in either direction. The readlist's delete glyph is one of the casualties: 3.93:1 in colour, 3.49:1 once the hue is gone. A pass in one lens, a failure in the other. The audit now asserts each measured pair through both, and 4 of the shipped fixes were only ever visible to the second.

## White on amber, unmeasured

The audit carried a blind spot of its own. For a filled control it recorded the fill against the page at the 3:1 non-text line, then skipped the words painted on top of the fill. That gap hid the primary button, the one button in the product, carrying the readlist's save bar and the login submit, with a white label sitting on amber at 3.65:1 in light and 3.10:1 in dark.

A button carrying a word is identified by that word.

The text pass now reads the label against the fill at the full 4.5:1, and the fill-against-page check is scoped to icon-only controls, where the fill really is the only cue left. The amber itself darkened to the lightest shade that carries white at 4.61:1, and it holds one value in both themes, because a fill and a text colour need opposite lightness as the page darkens.

## Reading with the script turned off

Two findings had nothing to do with contrast. The readlist's thumbnails were revealed by an inline `onload` handler on a hidden wrapper, and a browser with scripting off runs no handlers, so each card kept a blank 120 by 78 strip where its image belonged. The handler and the hidden state were one mechanism, and both are gone.

The image shows up because it's there.

The site menu was worse. Below 768 pixels it sat parked off-canvas, and only a script could slide it in, so a signed-in reader without scripting had no path to the logout link. It's a plain `details` disclosure now, and opening an article or marking it read works as an ordinary form submit on the same scriptless page.

## Measured on each build

Each check ran against the unfixed code before it was kept, because a gate that can't fail is worse than no gate. One arm rejects the old link colour by name, at 3.62:1. Another disables scripting and insists a card's thumbnail is genuinely visible. A third compares greyscale screenshots at a tolerance of 274 pixels out of 548,760, tight enough that reverting the link colour alone fails it.

Not every fix got a tripwire. The auth page's link underline and the active filter tab ride with no gate of their own, because the default screenshot tolerance barely counts an amber shift as a changed pixel, and tightening it under 61 layout baselines is a separate piece of work.

The next time the nearest screen is an e-reader's built-in browser, [your readlist](/?utm_source=blog-saved-articles-hold-up-on-e-ink&utm_medium=internal&utm_content=home) reads there the way it reads on this one, and the clean copy of each save is waiting behind its card.
