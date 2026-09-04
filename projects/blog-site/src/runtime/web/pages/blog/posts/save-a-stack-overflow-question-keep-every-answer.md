---
title: "Save a Stack Overflow Question, Keep Every Answer"
description: "A Stack Overflow thread saved to Readplace now comes back whole: the question, its code, and the answers under it. The stored copy of the site's most upvoted question grew from 1,196 words and a lone answer to 10,302 words and all 25, and the save stopped depending on winning a race against a bot wall."
slug: "save-a-stack-overflow-question-keep-every-answer"
date: "2026-09-01"
author: "Fayner Brack"
keywords: "save stack overflow questions, stack overflow read it later, read stack overflow offline, stack overflow atom feed, cloudflare bot wall, save a whole thread with answers, read it later for developers, pocket alternative, readplace"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

The reason to save a Stack Overflow thread is rarely 1 answer. 1 answer was all Readplace kept: its stored copy of the site's most upvoted question held 1,196 words, with no question and no code. The crawl now reads the question's own Atom feed, which Stack Overflow serves without the bot wall that guards the page, so the same save stores the question and all 25 answers, 10,302 words, in about 10 seconds. When the feed doesn't answer, the old path still runs underneath.

</div>
</details>

Stack Overflow's [most upvoted question](/view/stackoverflow.com/q/11227809) asks why a sorted array is faster to process than an unsorted one. The copy Readplace had stored of it ran 1,196 words and held neither the question nor the code sample the whole thread argues about. What it held was 1 answer, the block an extractor scored highest on a page it could barely reach.

## The wall in front of the page

Cloudflare sits in front of stackoverflow.com, and it answers a question page fetched from a datacenter with a challenge instead of the page: a 403 that says, in effect, prove you're a browser. Readplace's crawler lives in a datacenter. For months the only route to a question was a metered unlocker, a proxied pass through residential egress that solves the challenge and hands the page back.

The pass worked, at a price. The canary watching this route recorded 11 proxied passes in its last 11 runs, each one taking 15 to 55 seconds. Then on 28 August a solve stalled past its lease and produced no response at all, and the crawl filed the article as blocked. The row sat that way for close to 23.5 hours, which for anyone saving that question would have read as a failed save.

The first fix I shipped was narrow: a stalled pass gets 1 fresh retry while the budget allows it, because both recoveries on record for that URL came from a new request rather than from waiting on the stuck one. That turned the canary green again and left the shape of the problem standing. Every read of every question still went through the wall.

## The feed on the other side

Each Stack Overflow question publishes an Atom feed at /feeds/question/ followed by its number. The feed carries the question body and the body of each answer, the same HTML the page renders... and no challenge in front of it.

> **The site that challenges the page serves the same thread on a feed it doesn't guard.**

The crawl now asks the feed first and composes the article from what comes back: the question up top, then each answer under a heading naming the person who wrote it.

The feed gets a 10-second budget, and that number is doing work. The proxied pass refuses to arm unless 27 seconds of crawl budget remain, so a rule that spends at most 10 runs out before the meter is an option. Reading a question this way costs nothing and takes seconds instead of the better part of a minute.

When the feed doesn't answer, the rule steps aside rather than failing the save. Behind a Stack Overflow URL there is a real page worth fighting for, so the whole old ladder, proxied pass included, still sits underneath it.

## What the whole thread weighs

Back to the sorted-array question. Off the page, the extractor kept the 1 answer it could score: 1,196 words, no question, no code. Off the feed, the stored article holds the question and all 25 answers: 10,302 words. An answer thread is a conversation, and the copy finally reads like one, disagreements, benchmarks and all.

```rp-figure
kind: bars
title: The stored copy of Stack Overflow's most upvoted question
note: Measured on question 11227809, saved through the page path before the change and through the question's Atom feed after it.
before: Off the page
after: Off the feed
row: Words stored | 1196 | 1,196 | 10302 | 10,302
row: Answers kept | 1 | 1 | 25 | all 25
```

A smaller repair rides along. The saved URL for that question still carries its old title in the slug, and the live question has been renamed since. The feed is addressed by the question's number and ignores the slug, so a link saved years ago reads the thread as it stands today.

## The thread you meant to come back to

A Stack Overflow tab is the kind that stays open for a week, because the accepted answer solved the immediate problem and the 4 answers below it looked worth a slower read that hasn't happened yet. That slower read is what a readlist is for, and it only works if the save holds the part you were coming back for.

It does now. When a search strands you halfway down a thread, [the browser extension](https://readplace.com/install) puts the whole of it, question and answers, in [your readlist](/) to finish on your own time.
