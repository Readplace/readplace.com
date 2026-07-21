---
title: "A Card That Changes Itself Owes You a Word"
description: "A card fetching an article's preview used to look exactly like one that had failed, both a grey web address that redrew itself every few seconds in silence. Readplace now gives each card a note that names its state, announces the result to a screen reader, and keeps keyboard focus on the button you were aiming for."
slug: "card-shows-what-its-preview-is-doing"
date: "2026-07-21"
author: "Fayner Brack"
keywords: "read it later loading status, see when a saved link is loading, read it later shows progress, accessible read it later app, screen reader reading app, keyboard accessible read later, newsletter link preview, read it later fetching preview, save a link see if it worked, read it later live status"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Each link a newsletter drops into your Readplace inbox gets a preview fetched in the background, and the card holding it redraws itself every 3 seconds while that runs. For up to 15 minutes it did that in silence. A link still fetching, a link that had failed for good, and a page that came back with no title all showed as the same grey web address, so there was no telling whether waiting was worth it. Each card now carries a short note that names its state: "Fetching preview…" while the crawl runs, "Preview didn't arrive" once the 15 minutes are spent, "No preview available" when the page can't be read. The note reads the link's own status rather than whether the card is still polling, so a link that ran out its budget no longer looks the same as one that succeeded. A screen reader hears it too. A live region beside the list speaks once when a card resolves, "Preview ready:" and the title, and stays quiet on a tick that changed nothing. Keyboard focus survives the redraw now, so tabbing to a card's Save button no longer drops you to the top of the page every 3 seconds. The card still saves to your queue whatever its preview did.

</div>
</details>

Three cards in the newsletter inbox could look identical. One was still fetching its preview, another had failed for good, the third had come back from a page with no title to show. All three rendered as the same grey web address, and the card holding them redrew itself every 3 seconds without saying which was which.

A card that changes itself on a timer is easy to build and easy to leave silent. The silence is the part that fails the reader. If a card is going to rewrite itself every 3 seconds for as long as 15 minutes, it owes you a word on what it is doing.

> **A card that rewrites itself on a timer owes you a word on what it is doing, to the eye and to the ear.**

## The state it was guessing

The card did carry a kind of status underneath, but it read the wrong thing. It looked at whether it was still polling and called that the answer. A card that had stopped polling counted as finished, whatever had actually become of the link.

That held at the good edge and broke at the bad one. A crawl that succeeded stopped the poll, and the card went quiet, correctly. A pending link that simply ran out its 15-minute budget also stopped the poll, and the card went quiet the same way, as though the preview had landed. The two looked alike and were not.

The note reads the link's own status now, not the poll. While the crawl runs, it says "Fetching preview…". Once the 15 minutes are spent and nothing came back, it turns to "Preview didn't arrive". A page the crawler cannot read at all shows "No preview available". And a page that comes back with a title says nothing, because the title standing where the grey address was is the sign that the fetch worked.

## The card that announces itself

A note on the screen only helps a reader watching that spot. Some readers are not. A screen reader user hears the page, and a card that swaps its own contents in place says nothing to that ear on its own. The text just changes, and the change goes unspoken.

So the page carries one live region, a small element set aside to be read aloud when its text changes. When a card resolves, the region speaks once: "Preview ready:" and the title of the article, or a plain "No preview available" line when the page could not be read. While a card is still pending it writes nothing, so a 3-second tick that changed nothing stays silent instead of repeating the same sentence on a loop.

The region had to sit apart from the cards, not inside one. Each card replaces its whole element on every poll, so a live region tucked inside a card would be torn out and rebuilt every 3 seconds, which a screen reader reads as either nothing or the same words over and over. Set beside the list, the region stays put while the cards churn, and the poll writes the one announcement into it when there is something to say.

## Focus that survives the redraw

A card is not only something to read. It carries buttons, a Save to queue and a report control for a link that turns out not to be an article. A reader working by keyboard tabs to one of those and presses it.

The redraw used to knock them off it. Every 3 seconds the card replaced its whole element, buttons included, and the browser had nothing to tie the new button to the old one. Keyboard focus fell back to the top of the page. On a pending card that repeated every 3 seconds for the length of the crawl, up to 15 minutes of a reader being bumped to the top each time they tried to aim.

The card and its buttons carry stable ids now. When the redraw swaps in the fresh copy, the browser matches each new button to the one it replaced and leaves focus where the reader put it. Tabbing to Save and waiting through a poll no longer means starting the tab over.

## What a self-updating card owes you

A card that fetches something in the background is doing a reasonable thing. The fetch itself is not the trouble. It is the fetch running behind a face that gives no sign of it, so a reader sits watching a grey address with no way to know whether the patience will be paid back.

The fix is not clever. Read the real state, name it in words, say it to the ear as well as the eye, and don't throw away where the reader's hands were while you redraw. None of that makes the crawl faster. It makes the wait legible, which is most of what a wait needs.

> **Naming the state doesn't shorten the wait. It turns waiting into something you can read.**

## Watch a card resolve

Send a newsletter issue into [an inbox address of your own](/blog/save-newsletter-links-to-your-queue) and open it while the links are still coming in. The cards fill with grey addresses first, each one carrying "Fetching preview…" beneath it. Watch one turn into a titled article, or settle into "Preview didn't arrive" if the page would not open in time, the same [clean copy every saved link becomes](/blog/read-any-article-clean-reader) either way. Tab through a card's buttons while that runs, and your place holds.

Point a newsletter at an address to see it in the inbox, or add [the browser extension](https://readplace.com/install) and drop a link into [readplace.com](/) to follow its card the same way. The wait to fetch a page hasn't changed. What changed is that you can watch it happen, on the screen and in your ear, instead of guessing at a grey line that keeps redrawing.
