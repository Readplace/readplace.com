---
title: "The reader brings back what you already read on a subject"
description: "A closed card near the top of the reader lists up to 3 articles you already finished on the same subject as the one you're reading, why each one connects, and how long ago you read it. It appears only when a genuine match exists, so a familiar argument comes back with its source and its date instead of staying a vague feeling."
slug: "the-reader-brings-back-what-you-already-read"
date: "2026-09-19"
author: "Fayner Brack"
keywords: "have i read this before, remember what you read, reading history recall, previously read articles, resurface old reads, read it later with memory, connect articles you read, personal reading memory, readplace"
tags: ["changelog"]
banner: "The reader reminds you of what you've already read"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Halfway into a new article, the sense of having read this before now comes with receipts. A closed card near the top of the reader in Readplace lists up to 3 pieces you already finished on the same subject, the reason each one connects, and the day you read it. The card appears only when a real match exists, so opening it means there's something worth remembering.

</div>
</details>

An article read 8 months ago survives as a feeling. The argument sounds familiar, but the piece that made it, and the week it was read, are gone.

The reading list had both the whole time. It holds the article and the timestamp of the read, and until this week it handed one back only at the end of an article, and only when nothing unread related.

Now the reader hands them back at the top, before the text begins.

## Between the summary and the first paragraph

Open a saved article and a closed card can sit under the TL;DR, before the text begins. Its label is the sentence it exists to say: "You've already seen this before". Beside that, a preview of the best match, title and site, and a "See more".

Expanded, the card holds up to 3 articles you finished that discuss the same subject as the one on screen. Each row carries the title, the site, a one-line reason naming the subject both pieces are about, and a line like "You read this 3 weeks ago". Pressing a row opens the old read.

The position is deliberate. A reminder of what you already know is worth the most before the next 20 minutes get spent, not after.

## The bar a match has to clear

A model picks the matches, and its instructions are strict about what counts. Both pieces have to be largely about the same named thing: a language, a tool, a study, a person, a debate. Coming from the same website doesn't qualify, and neither does sharing a tone or a broad field like "technology".

The instructions state the priority outright: returning nothing beats returning a loose match. If the reason line only sounds true with a hedge in it, the pick gets dropped instead of the hedge getting written.

> **A match has to name the subject both pieces are about, or it doesn't appear at all.**

So 3 is a ceiling, not a target. For most articles the honest count is 0, and a card with 0 rows doesn't render. The absence is what makes the card worth trusting when it does show up.

Junk gets filtered before any of this. A saved link whose stored text turned out to be a bot check or a 404 page has no subject to be about, so it can't come back as a false memory.

## The date is the part your memory drops

Recognising a familiar argument is something your own memory manages too, on a good day. What it drops is the when.

Each row's date is the most recent time you marked that article read, in whichever readlist that happened. "You read this 5 days ago" and "You read this 14 months ago" ask for different things: skim what's fresh, or accept that the details are gone and let the old piece be new again.

Could search have done the same? Only with a query, and the query is exactly what a faded memory can't supply.

## The pool is your finished reads

The candidates come from one shelf: articles you finished in Readplace, up to 1,000 of them. Nothing anyone else read is in there, and no interest profile sits behind it. The card runs without an embedding warehouse for the same reasons the Next-read card does, and those reasons are written up in [A Suggestion With No Warehouse Behind It](/blog/a-suggestion-with-no-warehouse-behind-it?utm_source=blog-the-reader-brings-back-what-you-already-read&utm_medium=internal&utm_content=post-a-suggestion-with-no-warehouse-behind-it).

The answer is computed when an article opens, then kept. Reopening the article reuses it, and the model runs again only when the library has changed enough to change the inputs. With JavaScript off the rows still render, and a plain button requests the matching when it hasn't happened yet. The reader inside the apps shows the same card the website does.

## A framework, a diet, an election

The card earns its keep on subjects read in layers: a framework followed across releases, a diet argument, an election. Layered reading is exactly what blurs together.

A good first test is the next thing you save on a subject like that, whether it arrives through [the browser extension](https://readplace.com/install) or gets pasted at [readplace.com](/?utm_source=blog-the-reader-brings-back-what-you-already-read&utm_medium=internal&utm_content=home). Open it in the reader, and the card under the summary says what you already covered, and when.
