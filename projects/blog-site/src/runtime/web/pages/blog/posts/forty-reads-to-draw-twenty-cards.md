---
title: "Forty Reads to Draw Twenty Cards"
description: "A full page of the Readplace queue is 20 cards. Drawing it used to fire 40 separate database reads, each hauling back the whole article row. Two batched, projected reads now do it, and the archive and delete buttons dropped a read of their own, which closed a race that could leave a broken half-row behind."
slug: "forty-reads-to-draw-twenty-cards"
date: "2026-07-28"
author: "Fayner Brack"
keywords: "fast read it later app, reduce database round trips, dynamodb batchgetitem projection, n+1 reads queue, conditional write attribute_exists, read it later performance, pocket alternative fast queue, why the queue loads fast, save articles fast list"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

A full page of the reading queue shows 20 cards, and drawing it used to fire 40 separate reads at the database, one for each card's summary and one for its crawl status. Each read hauled back the whole article row, including the old inline copy of the text the card never shows. Readplace now collects those into two batched reads that ask only for the fields a card renders, so 40 round trips become 2 and the heavy column stays on disk. The queue's archive and delete buttons dropped a read too. They used to look the row up to check it existed, then write. Now the write carries its own condition, so it is one round trip instead of two, and that change also closed a race where a delete landing mid-write could leave a broken half-row behind.

</div>
</details>

Twenty cards fill one screen of the reading queue. Drawing them used to cost 40 reads from the database, and the page could not paint the first card until the last read came back.

Each card needs two facts the article row does not show on its face: the short summary that sits under the title, and whether the crawl that fetches the clean copy has finished. The old code went and got them one card at a time. One read for the summary, one for the crawl status, 20 cards, 40 reads.

Each of those reads asked for the whole row. A saved article row still carries, on some older records, a full inline copy of the article text. The card shows none of it. So on a busy page the server dragged that column back 40 times and dropped it every time.

> **A read you don't need is latency the reader never agreed to pay.**

## Forty reads for twenty cards

The fix is two reads, not 40. Readplace now asks for every card's summary in one [batched read](/view/docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html), and every card's crawl status in a second. Two round trips draw the whole page.

Both batched reads name their columns. They ask [DynamoDB](/view/en.wikipedia.org/wiki/Amazon_DynamoDB) for the handful of fields a card renders and leave the inline text alone. The row can stay heavy. The read stays light.

Failure behaves the same as before, on purpose. A row that is missing, or corrupt, or shaped wrong comes back as no summary for that one card, and the card still draws. What changed is the whole-batch case. If the read to the database itself falls over, it now lands in the log instead of vanishing, so a real outage leaves a trace to find.

## A read that only guarded a write

The render path was the loud cost. The mutation path had a quieter one.

Every time you archive a card or delete it, the queue writes to the row. Before that write, the old code read the row first, to check it was there. That read did no work the write couldn't do itself. Archiving and deleting are the queue's most-used buttons, and each tap paid for two round trips when one would do.

Now the write carries its own condition. The update runs only if the row still holds its saved-at marker, checked as the write lands, and the read in front of it is gone. One round trip. The button answers sooner.

## The phantom row

Removing that read did more than save a trip. It closed a bug the read had been hiding.

Two things can reach the same card at once. A delete and a status change can race. With the read-then-write shape, the status change could read the row, the delete could land, and then the status write could put the row back without the saved-at marker the rest of the queue keys on. A half-row. The article was gone from your list, but a stub of it stayed in the table, and it broke the lookup that finds an article by its URL.

The conditional write can't make that stub. If the delete wins, the status write finds no row to update, its condition fails, and it stops. The loser of the race gets back a plain false and changes nothing.

> **The read wasn't only slow. It was the gap the race lived in.**

The two fixes are the same move. A read taken to decide what a write already knows, or to fetch a row a batch could fetch beside 19 others, is a round trip the reader waits through for nothing. Take it out and the page is faster. With the delete race, taking it out was also the fix for a bug I hadn't set out to find.

## Time your own queue

Caching the slow reads would have made the queue feel quicker. Deleting the reads made it quicker and left less behind to break.

Save a stack of links with [the browser extension](https://readplace.com/install), let the crawl catch up, and open [your queue](/) once it has filled. The load you're watching is the one those 38 extra reads used to sit in the middle of.
