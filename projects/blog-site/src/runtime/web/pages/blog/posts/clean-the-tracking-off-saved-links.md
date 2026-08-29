---
title: "Cutting a Link Down Can Break It"
description: "Readplace saves the article links out of your newsletters, and now it clears the utm tracking tags off them too. Only the utm tags go, and only after the page is crawled, because the other parameters can be the part that makes the link open."
slug: "clean-the-tracking-off-saved-links"
date: "2026-07-22"
author: "Fayner Brack"
keywords: "remove utm parameters from url, strip tracking from links, clean newsletter links read it later, save a link without tracking, utm_source utm_medium utm_campaign remove, read it later removes tracking, tidy up saved links, tracking parameters in email links, keep a link working after stripping tracking, share a clean link"
tags: ["changelog"]
banner: "I strip the tracking tags off the newsletter links you save"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

A link a newsletter sends you carries a tail the sender bolted on to count the click: utm_source, utm_medium, utm_campaign, sometimes a run of them. Readplace saves the article links out of a newsletter into your readlist, and until this week it kept those tags in the saved copy. It clears them now, off the card's link, the URL you read, and the copy that lands in your readlist. Only the utm tags go. The strip-tracking function Readplace already had does more than that, dropping gi, source, and sk too, and those can be the parameter that makes a link resolve, so reusing it would hand back a shorter address that 404s. The cleanup also waits for the crawl. A link fresh out of an email is often an email provider's redirect whose real target sits in a path token and which may sign its own query, so rewriting it before it resolves risks a 403 rather than a tidier link. Readplace stores and crawls the link byte for byte, then clears the utm tail once the crawl has followed the wrapper to the page. Because the stored identity of an article already ignores utm, cleaning the visible URL this late changes the card, not the record behind it.

</div>
</details>

Look at the end of a link a newsletter sent you. Past the real address sits a tail the sender added: [`utm_source`, `utm_medium`, `utm_campaign`](/view/en.wikipedia.org/wiki/UTM_parameters), sometimes a run of 5 or 6. None of it points at a page. It's there to count the click and name the campaign that paid for it.

The obvious thing to do with that tail is cut it off. A trimmed link reads like the same link with the noise gone. Cut the wrong piece, though, or cut it too soon, and the address stops opening.

Readplace [saves the article links out of a newsletter into your readlist](/blog/save-newsletter-links-to-your-readlist). Until this week it carried the utm tags in with them. The Extracted Articles tab showed the tracking spelled out in the URL, and a saved copy kept it in the address. Those tags come off now: the link on the card, the URL you read under it, and the copy that lands in your readlist.

## The parameter that was doing the work

Readplace already had a function that strips tracking off a URL. It pulls the utm tags, and it also drops gi, source, and sk, re-sorts the survivors, and re-encodes them. That one isn't built for display. It builds the identity that keys every stored copy of an article, so it has to flatten a messy URL down to one stable form that two saves of the same page will share.

Reusing it to tidy the visible link would take gi, source, and sk with it. On some sites those carry weight. A `sk` on one link, a `source` on another, can be the parameter that decides which page the server returns. Drop it to shorten the display and the reader gets a link that 404s. So the cleanup that runs on a saved article strips utm and stops. Any parameter that isn't a utm tag is left exactly where the newsletter put it.

> **A shorter link is only safe once you know which part of it was doing the work.**

The removal is careful even about how it rebuilds the address. It edits the raw query string by hand rather than running it through the browser's URL parser, because that parser re-encodes what it keeps. A space in a surviving parameter comes back as a `+`, and you'd be handed a link one character off from the one the newsletter sent. Readplace splits the query on `&`, drops the utm pieces, and joins the rest back untouched.

## Late enough to be safe

The cleanup waits for the crawl. A link straight out of an email is often not the destination at all. It's [the email provider's redirect](/blog/save-the-article-not-the-redirect), a tracking wrapper whose real target sits inside a path token, sometimes with a signature laid over its own query. Rewrite one of those before it resolves and you don't get a cleaner link. You get a 403.

So Readplace keeps the link byte for byte while that matters. It stores the address as the newsletter wrote it and crawls that, following the wrapper all the way to the page it stands for. Only after the crawl has landed on a real destination does it clear the utm tail. A link still in flight keeps every character it came with.

Cleaning the URL this late can't split your library either. The stored identity of an article ignores utm from the start, so the copy with the tags and the copy without them were always the same row. Taking the tags off the address you see changes what's on the card, not the record underneath it.

## Open a saved link and look at the end

The tags being gone shows up most when a link leaves your readlist. Copy a saved article's URL to send to someone, and with the utm tail on it you'd be passing along the campaign id the newsletter stamped for you, tying that person's click back to your subscription. The link Readplace hands you is the article's own address, with the sender's bookkeeping taken off.

Stripping every tracking tag off a link is the fast idea of clean. Stripping only the tags you can show do nothing, after the link has resolved to a page, is the one that still opens when you tap it.

Forward the next issue you get to [a Readplace address](/blog/save-newsletter-links-to-your-readlist). Once the crawl catches up, open the saved article and read the link sitting at the top, the utm tail gone and the page still loading behind it. The first address is yours to set up at [readplace.com](/).
