---
title: "How AI TL;DR Actually Works in Readplace (And Why It's Not Slop)"
description: "Readplace uses AI to generate short article summaries for triage, not replacement. Here's how it works technically, and why it avoids the usual AI content problems."
slug: "how-ai-tldr-actually-works"
date: "2026-05-06"
author: "Fayner Brack"
keywords: "ai summary, read it later, article tl;dr, deepseek, ai slop, readplace app"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Readplace generates a short TL;DR for each saved article using DeepSeek V3. Summaries are cached globally by URL, so one API call serves anyone who saves the same link. The prompt bans corporate jargon and forces plain language. The summary is a triage tool to help you decide when to read, not a replacement for reading. Readplace skips smart highlights, AI commentary, and daily briefings.

</div>
</details>

If you have read more than a handful of AI-written articles, you know the texture. It reads like it came out of a tube. The "key takeaways" listicle flattens every nuance into 5 bullets nobody asked for, and the LinkedIn post says nothing across 3 paragraphs. The word "slop" stuck because it describes the result better than anything else.

So scepticism about "AI summaries" in a read-it-later app is fair. You have been trained to expect the tube.

This post lays out how Readplace's TL;DR works, the choices behind it, and where it stops on purpose.

The goal is to give you a way to judge whether a summary feature helps you read or just helps you skip reading.

## You Choose What to Read

Most AI content features answer one question for you: what should you look at next. They curate. They pick what is interesting, decide what you see, and rank your attention against an engagement metric.

That's the algorithmic feed, and escaping it is the reason people use read-it-later apps in the first place.

When you don't pay for the product, your attention is the thing being sold.

Readplace's TL;DR curates nothing. You already saved the article, so the choice of what to read was yours before any summary existed.

The summary answers a narrower question: when is the right moment to read this?

Picture your queue on a Tuesday morning. You have 15 minutes before a meeting and 30 saved articles, and the TL;DR is what tells you which ones are a quick scan and which ones want a full hour. It sorts your own list by effort, and it leaves the list itself in your hands rather than an algorithm's.

> **The summary helps you decide when to read an article, not whether you were allowed to save it.**

## What the Summary Is

Each TL;DR is a few plain sentences about the article's core argument or finding. No markdown formatting, no "5 Key Takeaways" header, no pulled quotes. Just a short description of what the piece actually says.

The prompt that generates these summaries carries a blocklist of corporate filler words, the kind that turn a sentence into a press release without adding a single fact.

If a summary reads like marketing, the prompt is broken, and I treat that as a bug to fix rather than a quirk to live with.

The rules it enforces are simple: active voice, short sentences, plain connectors, specific facts, and no jargon.

> **Write like a person explaining an article to a friend. That is the instruction the model gets.**

## How It Works Under the Hood

Summaries come from DeepSeek V3, the `deepseek-chat` model. I chose it for this job because it handles concise factual summarisation well and the economics hold up at scale. The cost sits inside the subscription, so you don't pay per summary.

The design choice that matters most is **one summary per URL, cached globally**.

When you save an article, Readplace checks a cache before it calls anything. If someone saved that exact URL before you, you get their summary back with no model call at all.

On a cache miss, DeepSeek writes the summary once and stores it for whoever saves the link next.

That single decision does two things at once.

**It keeps the cost predictable.** A per-user model would burn API credits on duplicate work, because 10 people saving the same article would mean 10 calls producing 10 near-identical summaries. Global caching collapses that to one call, no matter how many people end up saving the link.

```rp-figure
kind: budget
title: One summary per URL, however many people save the link
note: A per-user model repeats the work on every save; the cache collapses it to a single call.
input: People who save the same URL
oldLabel: A per-user model · one call per save
newLabel: One summary per URL · cached globally
unit: model calls made for that link
step: 1 | 1 | 1
step: 10 | 10 | 1
```

**It removes personalisation bias.** Every reader sees the same summary for the same URL, so there's no filter bubble and no reframing based on what you have read before. The summary reports what the article says, and that's the whole contract.

There is also a minimum-length check. Articles below the threshold skip the summary step, because a piece short enough to scan in one sitting gains nothing from being compressed further.

## Why DeepSeek and Not a Frontier Model?

I tested several models against the same articles, and for short factual summarisation of web pages, DeepSeek V3 landed at the balance of quality and cost I wanted. The honest reason is that the task does not need more than that.

Summaries are capped at 750 characters. You don't need a frontier model to write 3 accurate sentences, and paying for one would mean either metering the feature or raising the price.

Claude runs as a fallback in some code paths, but the default pipeline calls DeepSeek at save time.

It does the work well and keeps the per-article cost low enough that I can offer it without a meter.

## The Line I Won't Cross

I built Readplace for people who read, not for people who skim and call it consuming content. A summary feature could undercut that, so here is where it stops.

The model I use to draw the line is the difference between a shelf card and a book summary. A shelf card helps you pick the book off the shelf. A book summary that stands in for the book tells you not to bother reading it. The TL;DR is meant to be the shelf card.

So Readplace won't generate "smart highlights" that let you skip the article, write AI commentary on the things you saved, or roll your reading list into a daily briefing. Each of those turns a reading app into a tool for avoiding reading, which is the one job it was built against.

The TL;DR helps you choose what to read. Then you read it.

Read the Web, not the Slop.
