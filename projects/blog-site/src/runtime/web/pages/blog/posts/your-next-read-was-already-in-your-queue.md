---
title: "Your Next Read Was Already in Your Queue"
description: "Finish an article in Readplace and a small card offers one related article from your own unread saves: the title, one sentence on why the two go together, and how long ago you saved it. The picks come from a model that reads only your queue, the card waits until the text runs out, and dismissing it holds on every device."
slug: "your-next-read-was-already-in-your-queue"
date: "2026-08-09"
author: "Fayner Brack"
keywords: "what to read next, read it later suggestions, next read from your own saves, resurface saved articles, read it later graveyard, pocket alternative with suggestions, related articles from my own queue, rediscover old saves, reading queue recommendations, read it later app suggests next article"
tags: ["changelog"]
banner: "I made Readplace pick your next read from your own saves"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Finishing an article used to be a dead end: the text ran out, and the way back to the queue was the back button. Readplace now floats a small card beside the last lines with one thing to read next, drawn from your own unread saves rather than from the wider internet. The picks are made when you save. A model reads the new article and up to 1,000 saves you haven't opened, keeps up to 3 that belong beside it, and writes one sentence on what each pair shares. The card shows the first of those still unread, with the site, that sentence, an Unread badge, and how long ago you saved it. It stays hidden until the end of the article scrolls into view, so nothing sits over the text. Reading a suggestion removes it from the pool, marking it unread brings it back, and dismissing the card holds on every device. Clicking through asks one question on the way out: mark the finished article as read, or keep it unread. The card needs 50 unread saves before it has enough to draw from, and it ran behind a feature flag until this week, when it reached every reader.

</div>
</details>

"You are a librarian for a read-it-later app called Readplace."

That line opens the instructions Readplace hands a language model each time an article lands in a queue. The model reads the article that was just saved, looks through the older saves the same reader hasn't opened yet, and picks up to 3 that belong beside it. For each pick it writes one sentence naming what the two pieces share.

Until this week those picks ran behind a feature flag. Now they reach every reader, as a card that appears when an article ends and offers the thing to read next.

The card has one rule that makes it worth writing about: it draws from your own queue and from nowhere else.

> **The model is shown your unread saves and nothing else.**

A [recommender system](/view/en.wikipedia.org/wiki/Recommender_system) usually means other people's clicks deciding what you see. This one has no other people in it. What comes back isn't new material to acquire. It's your own reading list, resurfacing at the one moment you're looking for something to open.

## Picked while the save is fresh

The selection runs when you save, not while you read. A save hands the model the new article and up to 1,000 unread saves to compare against. The picks are stored with the article. Reading, marking unread, dismissing, and deleting cost no model call at all.

It needs material to draw from. Below 50 unread saves the selection skips, and the card stays away until the queue reaches that line.

The stored picks are filtered against your read state each time the page draws. Open a suggestion and read it, and it drops out of the pool. Read all 3 and the card has nothing left for that article, so it shows nothing. Mark one unread and it returns. What the card offers is related and still waiting, both at once.

TBH the picks aren't all equals. The instructions tell the model that a plausible pair beats an empty answer, so next to a follow-up on the same subject you'll sometimes meet a looser cousin, two pieces that share a field rather than a thread =/ ... The sentence on the card names what the two share, so a stretch announces itself before the click.

## A card that waits for the last line

The card holds back until the bottom of the article body scrolls into view. Nothing floats over the text while there is text left. Reach the end and it settles into the corner of the reading column: the title, the site, the model's sentence, an Unread badge, and one more line. You saved this 2 months ago.

That date line is the part I'd point at.

A suggestion with a save date on it answers a different question than a feed does, not what people with your tastes clicked today, but what you set aside for yourself and how long it has waited.

The whole card is one target, so a click anywhere on it opens the suggestion. The X in its corner is the one part that does something else.

An earlier version of this sat inline under the article as a list of 3 links. A list at the end of a piece meets a reader who has already decided to stop, and 3 choices at that moment are 2 too many. The card keeps one, and the others wait their turn.

## Dismissed once, dismissed everywhere

The X posts to your account, not to the browser. Dismiss a suggestion on the laptop and the phone stops showing it too, because the dismissal is stamped on the saved article rather than kept in a cookie.

Clicking through asks one question on the way out. Leaving an article by a link is the moment the queue needs a fact recorded, so Readplace asks whether the article being left is finished. The two buttons spell out both outcomes, "Yes, Mark as Read" and "No, Continue and Keep Unread", and the queue stays right about what was read.

## Give it a pile to draw from

A queue of 50 unread saves reads as a backlog. It works as fuel now. Each finished article draws one old save back out of the pile, with a written reason it belongs next.

A feed offers more of the internet. This card offers a piece of it back, the piece you already chose.

If the pile is short, [the browser extension](https://readplace.com/install) grows it a click at a time, and the first card is waiting behind whatever you finish next at [readplace.com](/).
