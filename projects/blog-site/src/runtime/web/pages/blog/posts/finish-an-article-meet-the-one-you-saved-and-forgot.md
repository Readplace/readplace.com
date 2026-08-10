---
title: "Finish an Article, Meet the One You Saved and Forgot"
description: "Reach the end of an article in the Readplace reader and a small card now offers the next one: an article already in your queue, still unread, related to the one just finished, with a line saying what the pair shares. It picks from your own saves and nowhere else, so a deep backlog starts paying you back."
slug: "finish-an-article-meet-the-one-you-saved-and-forgot"
date: "2026-08-10"
author: "Fayner Brack"
keywords: "actually read saved articles, save articles but never read them, read it later backlog, next read suggestion, related articles from your own saves, reading queue that picks your next article, tsundoku digital articles, pocket alternative that helps you read, finish your reading queue, ai picks from your own library"
tags: ["changelog"]
banner: "I made the reader pick your next article from your own unread saves"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Finish an article in the reader and a small card now waits past the last paragraph. It holds one thing: the next article to read, picked from your own queue. Each time something is saved, Readplace hands the new article and up to 1,000 unread saves to a model prompted as a librarian, which picks at most 3 earlier saves that relate and writes a line for each naming what the pair shares. The reader shows the first pick still unread, and only once the end of the article scrolls into view, so it can't cover text still being read. Clicking the card asks whether the finished article should be marked read, then opens the next one. Dismissing it hides it for that article on every device. The picks come from articles you chose to save and from nowhere else. No AI call runs while you read, since the choosing happened at save time. The card stays silent below 50 unread saves, and reading the picks shrinks the pool it draws from. That's the point.

</div>
</details>

"Both pieces pull at the same caching decision from opposite ends." A line in that shape now sits on a small card near the end of anything you finish in [the Readplace reader](/blog/read-any-article-clean-reader). The title above it belongs to an article you saved weeks or months ago and haven't opened since.

The card is called Next read, and it's on for every reader now.

## The moment the queue kept missing

Saving is the easy half of read-it-later, and that's the trap of the whole category, my own app included. A save costs one click at the moment interest peaks. The reading costs half an hour that has to come out of some later evening, long after the peak has passed. So a queue grows at the pace of your curiosity and shrinks at the pace of your free time.

Japanese has a word for the paper version of this, [tsundoku](/view/en.wikipedia.org/wiki/Tsundoku): books bought and left in a pile, unread.

A reading queue is that pile with better search.

One moment in the loop runs the other way. Finish an article, and you're still in the chair, the reader is open, and the appetite that brought you there hasn't faded yet.

Readplace used to do nothing with that moment.

The article ended, and the way back was a list of cards with no opinion about what comes next.

> **The end of one article is the cheapest place to start another.**

## The librarian reads only your shelf

The picking happens at save time, not mid-read. Each save hands the new article, along with up to 1,000 unread saves, to a model whose prompt opens by telling it it's a librarian. Each candidate arrives as a title and an excerpt of at most 300 characters. The model picks at most 3 earlier saves that relate to the new one, and for each pick it writes one line, 120 characters or fewer, naming what the pair shares.

That line is the sentence on the card.

The prompt hands the model a ladder rather than a bar to clear. The top rung is the same subject, a follow-up, or the same event covered elsewhere. Below that sits the same argument seen from another side, and below that the same field approached from a different angle. It stops at the first rung that yields something, because a shelf one person filled is already connected in the ways that matter.

The pool is unread saves only. Read one of the picks and it leaves the list. Mark it unread again and it comes back. Nothing runs while you read, either: the librarian did its work when the save landed, and the reader only looks up what it wrote.

The librarian stays silent below 50 unread saves, since a smaller shelf isn't enough to compare against. It'd rather show nothing than stretch for a match.

## It waits for the last paragraph

Nothing about the card competes with the article that's open.

It stays hidden until the end of the article body scrolls into view, so it can't sit on top of a paragraph still being read. Reach the end and it's there, in the corner of the reading column: the title, the site it came from, the line about what the pair shares, and how long ago the save happened.

The whole card is one click target. Click it and the reader asks the question worth asking right then: did you read the article you're leaving? Yes marks it read and opens the pick. No opens the pick and keeps the current article unread. Closing the panel does neither and leaves the article open.

The X in the card's corner carries weight too. Dismiss the card and it stays gone for that article, on every device, not just in one browser.

An AI assistant connected to your account sees the same picks, so [asking it what to read next](/blog/ai-assistant-reads-your-saved-articles) draws on the list the card draws on.

## Where the picks can't come from

A suggestion engine is usually a doorway to more inventory. This one has no inventory to open. The picks come from the articles you chose to save and from nowhere else, so the furthest the card can lead is deeper into decisions already made. It has no way to hand over a stranger's argument from a site outside the queue, because it has nowhere to get one.

And when the unread pool runs dry, the card goes away.

A feed would treat an empty state as a failure to patch. Here it means the queue did the thing a queue is for.

> **The card can only offer what you already decided was worth your time.**

## Reach the end of something tonight

If your queue is deep enough that its bottom half embarrasses you, that depth is what the card feeds on. Open [anything you saved](/) and read it through to the last paragraph, and the corner of the reader will offer the thing it goes with. A queue that doesn't exist yet starts with [the browser extension](https://readplace.com/install).

A feed measures itself by how long you stay scrolling. This card measures itself by how much of your own queue you finally read.
