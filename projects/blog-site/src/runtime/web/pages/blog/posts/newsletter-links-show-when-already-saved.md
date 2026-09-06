---
title: "The Save Button Was Wrong Before You Opened the Newsletter"
description: "Readplace saves the article links out of your newsletters as they arrive, so most are in your readlist before you open the email. The Save button read Save to readlist for all of them anyway. It now marks a saved link as saved, from a fact every save publishes rather than a look into your readlist."
slug: "newsletter-links-show-when-already-saved"
date: "2026-07-26"
author: "Fayner Brack"
keywords: "see which newsletter links already saved, read it later saved indicator, newsletter readlist, save links from newsletters, already saved to readlist, newsletter inbox reader, forward newsletters to read later, avoid saving the same article twice, read newsletters later, read it later mark as saved"
tags: ["changelog"]
banner: "I made your newsletter inbox show which links you already saved"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Newsletter links you had already saved used to show a Save button as if you hadn't. Readplace pulls the article links out of a newsletter and saves them the moment the issue arrives, so by the time you open it in the inbox, most of those links are already in your readlist. The button read Save to readlist for all of them, because a saved link and an unsaved one rendered as the same button. The inbox has no permission to read your readlist, and that is on purpose, so the saved state now travels to it as a fact. Every save, from any part of Readplace, publishes one small event, and a list owned by the inbox records it one row per reader. The Articles tab reads that list in a single request and marks each link. A saved link shows a check and the word Saved, still clickable, still the same save. It matches on the link's address and does not follow redirects, so the same article reached through a different wrapper reads as unsaved, which costs you one extra click that saves the same thing.

</div>
</details>

The Save button under a newsletter link had one job. It had to tell me whether that link was already in my readlist, so I would know to open it or save it. It could not do that, and for a while I did not notice how badly.

An already-saved link, a link I had never touched, and a link whose save had failed all came out as the same button, down to the last byte. Nothing on the card carried the difference, so there was nothing to render.

On its own that is a small bug. It was not small here, because of how the inbox already works. Readplace [gives each newsletter its own address](/blog/save-newsletter-links-to-your-readlist?utm_source=blog-newsletter-links-show-when-already-saved&utm_medium=internal&utm_content=post-save-newsletter-links-to-your-readlist), and when an issue arrives it pulls the article links out and saves them for you right then. So by the time you open that issue in the inbox, most of its links are already in your readlist. The button was asking you to save things you had saved a minute earlier.

> **Most of those buttons were out of date before the reader ever looked at them.**

## The readlist I couldn't look at

The obvious fix is to check the readlist. Read each link, see whether it is already there, set the label to match.

I can't reach the readlist from the inbox. The part of Readplace that handles your newsletters runs on the [principle of least privilege](/view/en.wikipedia.org/wiki/Principle_of_least_privilege?utm_source=blog-newsletter-links-show-when-already-saved&utm_medium=internal&utm_content=read-en-wikipedia-org), holding only the keys its own work needs, and reading your reading-readlist tables is not one of them. That boundary is deliberate. Your newsletter mail and the articles you keep live apart, and the newsletter side has no way to read across into the other.

So the saved state had to arrive at the inbox as a fact it was told, not a table it went and read.

## The event that looked right

Readplace already publishes an event when an article is saved. My first attempt listened for it and marked the matching link Saved. It failed twice over.

That event fires when the crawler settles an article's canonical copy, not at the moment you save. Save the same article a second time and it stays silent. It also carries the article's canonical address, not the link you clicked, so even when it fired it named a different URL than the one on the card.

A button built on it would have read Save to readlist for a link you had saved twice, and would have missed the match any time a newsletter's link and the settled article disagreed about their address. It described content becoming ready, not a save being accepted. Wrong fact.

## One fact, at the point every save agrees

Every save in Readplace runs through a single step. The save bar on the site, the browser extension, the iPhone app, the import tool, and the newsletter pipeline all reach the same code that writes your readlist row.

That is where the new fact goes out. The instant the row is written the save is real, so right after it, one small event is published carrying the URL you submitted and nothing more. It fires on every branch, including the skip case where the article was already settled and no other event would have gone out at all.

> **The fact leaves at the one point every save already passes through.**

A separate list, owned by the inbox, records those facts one row per saved link per reader. When the Articles tab draws a page of links it reads that list in a single request and labels each button from it. The inbox still does not open your readlist. It reads its own copy of one plain fact: this link was accepted.

## What it shows, and where it still guesses

A link already in your readlist now shows a check and the word Saved. One you have not saved reads Save to readlist, as before. Saving itself did not change. The saved button is the same POST it always was, so it stays clickable, and pressing it again moves that article back to the top of your readlist, unread.

I left two gaps in on purpose. The match reads the link's address and does not follow redirects, so the same article reached through a different wrapper URL still reads as unsaved. And Readplace does not fill in links you saved before this shipped. TBH, both come out the same way: one extra click, and that click saves exactly what you meant to save.

```rp-figure
kind: matrix
title: What the Save button under a newsletter link shows
note: An already-saved link and one you had never touched used to come out as the same button, down to the last byte.
toggle: After every save started publishing the fact the inbox reads
head: For each link | Saved when the issue arrived | Saved a second time | Never saved | Saved under another wrapper URL
row: Word on the button | !Save to readlist>>Saved | !Save to readlist>>Saved | Save to readlist>>Save to readlist | Save to readlist>>Save to readlist
row: Mark beside the word | !none>>a check | !none>>a check | none>>none | none>>none
row: What the inbox was told | !nothing>>this link was accepted | !nothing>>this link was accepted | nothing>>nothing | nothing>>nothing at this address
```

## A button you can trust again

A saved-state indicator that can be wrong is worse than none at all. You learn it lies, then you stop reading it, and the doubt spreads to the parts that were telling the truth. So the button had to be right on the case that matters most, the link you saved thirty seconds ago without thinking about it.

If you already forward a newsletter into Readplace, open its Articles tab and the links you have saved will say so. If you don't yet, [give one newsletter an address of its own](/?utm_source=blog-newsletter-links-show-when-already-saved&utm_medium=internal&utm_content=home) and read the next issue as a short list of what is already waiting in your readlist.
