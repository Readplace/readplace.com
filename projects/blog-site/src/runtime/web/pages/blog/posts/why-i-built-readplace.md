---
title: "Why I Built Readplace"
description: "I ran my own reading system on Gmail filters and DynamoDB for ten years. When Pocket and Omnivore shut down, I turned it into a product. Here's the story, and the promise I wrote into the code."
slug: "why-i-built-readplace"
date: "2026-07-23"
author: "Fayner Brack"
keywords: "Readplace founder, why I built Readplace, js-cookie, read-it-later app, Pocket alternative, Omnivore alternative, build in public, data ownership"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

I wrote js-cookie, a tiny JavaScript library browsers download about 22 billion times a year, and for ten years I ran my own reading on Gmail filters, DynamoDB tables, and a stack of Reddit automations. That system taught me the bottleneck was never saving — it was deciding what *not* to read. When Pocket was acquired and abandoned, and Omnivore shut down overnight, the tool I needed didn't exist as a product anyone could use, so I turned my system into Readplace. It's a solo project, built in public. The part that matters most isn't a feature: if you ever stop paying, your account goes read-only rather than dark — you keep reading everything you saved, and Export stays in the menu. That behaviour is a few lines of code you can read on GitHub, not a promise on a page.

</div>
</details>

You might know me as the creator of [js-cookie](https://www.jsdelivr.com/package/npm/js-cookie), a JavaScript library that browsers download around 22 billion times a year — the tiniest, most consumed browser library in the world. So yes, I've been building for the web for a long time. I also read and share a lot of writing across it.

## The bottleneck was never saving

For ten years I ran my own reading on Gmail filters, DynamoDB tables, and a stack of Reddit automations. Links came in from everywhere, got filed, and waited for me. The pipeline worked, and it taught me the thing that shaped everything about Readplace: **the bottleneck was never saving. It was deciding what *not* to read.**

Saving is easy. Every app can save. What a decade of a growing queue actually needs is help telling the four articles worth your evening from the forty you optimistically clipped. That is why every saved article in Readplace opens with the reading time and a TL;DR already there — not to replace reading, but to let you skip well.

For the curious: as of mid-2026 that reading habit adds up to around 350k Reddit karma over 11,850 submissions and 15k on Hacker News over 2,700, all inside the decade since 2016. On average I read about 40% of what I find and share 60–70% of what I read. The ratio has shifted over time, as more comes in and the curation gets sharper.

## Why it became a product

Last year, when Pocket was acquired and then abandoned, and Omnivore shut down overnight, I realised the tool I needed didn't exist as a product anyone could use. Both shutdowns left people scrambling for their own reading lists. I had been quietly running mine the whole time.

So I started turning my personal system into Readplace — built in Australia, one feature at a time. It's a solo project. I'm building it in public, and I'd rather be honest about what works today than promise features that don't exist yet. I'm using twenty years of engineering experience to push AI-assisted coding to its limits while keeping Readplace a place where you read the web, not the slop.

## The promise I wrote into the code

Here's the part that matters most, and it isn't a feature.

A sentence about "we'll always let you export your data" does not survive an acquisition. What survives is the code. So the behaviour is written in rather than promised: if you ever stop paying, your account goes **read-only, not dark**. Your queue, your saved articles, and the reader all keep working — you keep reading everything you saved. Only saving new links and importing pause. And Export stays in the menu whether or not you're paying, so you can pull everything out as JSON any time.

The infrastructure sits in Sydney under Australian privacy law. The codebase is [on GitHub](https://github.com/Readplace/readplace.com) — source-available, so the branch that decides what a cancelled account can still do is something you can go and read rather than take my word for.

I can't promise Readplace will outlive Pocket and Omnivore. I can promise that if it doesn't, you won't lose your reading.

<div class="blog-cta">
<p class="blog-cta__title">Read the web the way I do</p>
<p class="blog-cta__text">Save a week of articles and let the reader view and the TL;DRs decide what's worth your time. If it doesn't fit, let the trial lapse — nothing is charged and your account goes read-only, with everything you saved still readable.</p>
<a class="blog-cta__button" href="/signup?utm_source=blog-why-i-built&utm_medium=internal&utm_content=end-cta">Start your 14-day free trial</a>
<p class="blog-cta__note">No credit card required. $4/month ($49/year) if you stay.</p>
</div>
