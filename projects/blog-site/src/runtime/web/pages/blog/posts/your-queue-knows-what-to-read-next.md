---
title: "Your Queue Knows What to Read Next"
description: "Finish an article in the Readplace reader and a small card offers one more, picked from your own unread saves, with a line on why the two belong together. The suggestions come from what you kept, not from the open web, and dismissing one holds on every device you sign in from."
slug: "your-queue-knows-what-to-read-next"
date: "2026-08-08"
author: "Fayner Brack"
keywords: "what to read next, read it later suggestions, next read suggestion, resurface saved articles, related articles from your saves, reading backlog, finish saved articles, pocket alternative suggestions, rediscover old saves, read it later app suggests next read"
tags: ["changelog"]
banner: "I put your next read at the end of the one you're finishing"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

At the end of an article, right as the last paragraph scrolls into view, a small card now slides into the corner of the reader with one suggestion: a saved article still unread, and a line on why it belongs beside the one just finished. Readplace picks it from your own queue and nowhere else. Each time a link is saved, a background job lines up as many as 1000 unread saves next to it and asks a language model, prompted to act as a librarian, to pick at most 3 that relate, each with a short written reason. The reader shows the first of those still unread, along with when it was saved. Read a suggestion and it drops out of the pool. Dismiss the card and it stays dismissed for that article across devices. Click through and the reader asks whether to mark the article you're leaving as read, so the queue stays honest. The picks need raw material: 50 unread saves is the floor, and below it the card stays away.

</div>
</details>

Reach the last paragraph of an article in the Readplace reader and a small card slides into the corner of the page. It carries one suggestion: an article already sitting in your queue, saved weeks or months ago, still unread, with a one-line reason it belongs beside the piece just finished.

The card waits for the end on purpose. It stays hidden while the text has your attention and shows up once the bottom of the article scrolls into view.

The end of an article is the one moment a reader is free to start another. That is the only moment the card takes.

## The queue that only took things in

My queue grew the way most reading queues grow. Saving takes one click and reading takes half an hour, so the list tilts toward saving. What went in 2 months ago sits a long scroll under what went in this morning.

> **An article you saved 2 months ago is not rejected, just buried.**

Readplace had the reminding half built, behind an experiment flag. For each new save it computed which of a tester's other saves related to it, then showed the results as a list of 3 under the article body, where they competed with the closing paragraphs and offered choices at the moment the reader had decided to stop. This week the flag came off, the list shrank to a single card, and the card reached every reader.

## A librarian over what you kept

The picking happens at save time. A new link lands in the queue, and a background job lines up as many as 1000 of its unread saves beside it. A [language model](/view/en.wikipedia.org/wiki/Large_language_model), prompted to act as a librarian, reads the pile and picks at most 3 saves that relate to the new arrival, each with a reason of 120 characters or fewer naming what the two share.

The prompt hands the model a ladder and tells it to stop at the first rung that yields something: the same subject or a follow-up first, the same argument from another side next, the same field or craft from a different angle last. A pick the model can't name a shared subject for isn't allowed out. An empty answer is fine when the saves share nothing with the new arrival.

What I care about most is where the pool ends. It's your saves and nothing else. A trending story or a partner link can't appear on the card, because neither exists in the inventory it picks from.

> **The card can only offer you something you already decided was worth your time.**

## Unread, then gone

Every suggestion is something you haven't read yet. Read one and it drops out of the pool. The list behind the card shrinks as you work through it, and the card stops appearing on an article once nothing unread relates to it.

Mark an old save unread and it's suggestible again. None of this costs an AI call, since reading, unreading, and deleting filter a list that was already computed at save time.

Dismissal is a real answer too. The X on the card stamps the dismissal on your account rather than in your browser, so a suggestion you waved away on the laptop won't chase you onto the phone.

Fresh saves needed one more piece. Save a link and open it straight away, and the suggestions are often still being computed while you read.

One fresh save, measured in production on 4 August 2026, got its relations written 97 seconds in. The old slot rendered once and stopped looking, so a reader in that window saw no card for the whole page view. The slot now asks again every 3 seconds until the computation settles, then goes quiet.

## Leaving one article to start another

Clicking the card means leaving the article under it, and the article you leave is the one the queue tends to get wrong. You read it to the last line, and it still counts as unread.

So the reader asks on the way out. Follow the card, or any link in the article body, and a small dialog names the article and asks: did you read it? "Yes, Mark as Read" files it, and "No, Continue and Keep Unread" moves you on and leaves it waiting.

Closing the dialog is the third answer. It cancels the exit and keeps you where you are.

An article marked at the moment you finish it is what keeps the pool clean. The unread filter is only as good as the read marks behind it, and the best time to collect one is the click where you leave.

## The floor is 50 saves

The librarian needs raw material, and the floor is 50 unread saves. Below that the job declines to guess, and the card stays away rather than arriving padded with weak matches. The floor used to be 100, and halving it is what lets a months-old queue qualify instead of a years-old one.

TBH, the librarian is a librarian, not a mind reader. The reason line names what the suggestion shares with the article just finished, not what you're in the mood for tonight. It sits on the card so you can judge the match in a glance, and the dismiss button sits beside it so a wrong guess costs one click.

## Past the last paragraph

The card only exists past the last paragraph, so the way to meet it is to finish something. Open the save that has waited longest in [your queue](/queue) and read it through. Past the ending is the next one you already chose.

A queue still short of the 50-save floor fills fastest with [the browser extension](https://readplace.com/install), and the finishing happens at [readplace.com](/).

An app that remembers your reading list is an archive. One that hands the right save back at the right moment is how the list gets read.
