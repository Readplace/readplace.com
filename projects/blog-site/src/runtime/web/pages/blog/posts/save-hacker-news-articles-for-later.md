---
title: "The Best Way to Save Hacker News Articles for Later"
description: "You open 15 tabs from the HN front page and read 3. The rest haunt your browser for weeks. There's a better system."
slug: "save-hacker-news-articles-for-later"
date: "2026-05-06"
author: "Fayner Brack"
keywords: "hacker news, save articles, read it later, hn reader, readplace"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Tabs are a guilt system, not a reading system. Separate discovery from reading: save HN articles to a queue during your morning scan, then read from the queue when you have time. AI summaries let you triage 30-40 saved articles in minutes. Readplace's browser extension works on news.ycombinator.com. One click saves the article and generates a summary.

</div>
</details>

It's 8am. Coffee in hand. You open news.ycombinator.com. Fifteen minutes later you have 12 tabs open.

A long post about SQLite page structures. Someone's war story about migrating off Kubernetes. A Show HN doing something clever with WebAssembly. A comment thread better than the article it's attached to.

You read three of them. The rest sit in your tab bar for days. Then you declare tab bankruptcy, or your browser crashes and makes the choice for you.

## The tab graveyard problem

Browser tabs are a guilt system pretending to be a reading system. Every open tab is a small promise you made to yourself and broke.

And HN links rot. That blog post on someone's personal site? Gone in six months. That PDF on a university page? 404 by next semester.

If something on HN is worth opening, it's worth saving. Tabs vanish. Your reading list should not.

## Comments are half the value

HN is different from every other link aggregator. The comment threads are often more useful than the article itself.

Someone posts about database indexing strategies. In the comments, a staff engineer at a large company drops a production war story worth more than most conference talks. That kind of knowledge only lives in the thread.

You need to save both: the article *and* the discussion. A system that only captures the link throws away half the value.

## What a reading workflow looks like

I spent ten years processing articles through r/programming, r/webdev, and HN. I landed on a rhythm that works:

**Morning scan.** Quick pass through the front page. Anything interesting gets saved to a queue.

**Lunch or commute.** The 5-to-10-minute reads. Practical posts, release announcements, short opinion pieces.

**Weekends.** The deep reads. Thirty-minute technical pieces. Long comment threads where someone patiently explains why your favourite database is wrong.

> **The trick is to separate *discovery* from *reading*.**

When you scan HN, your job is to triage, not to read. Mixing the two is how you end up with 40 tabs and nothing absorbed.

## Why a read-it-later app beats tabs

Tabs crash, links die, and you lose context. But there's a less obvious problem: tabs have no priority. They sit in the order you opened them. That order has zero correlation with what's worth reading.

A reading queue gives you one place to go when you have 20 free minutes. You stop hunting through tabs or trying to re-find that article from three days ago. It's just there.

And when an article disappears from the web (personal blogs, academic papers, startup pages go offline all the time) your saved copy still works.

## Triage 40 articles with AI summaries

After a full week of HN browsing, you might have 30 or 40 articles saved. You will not read all of them. Some seemed interesting at the time but aren't anymore. Some cover the same ground as others you already read.

AI-generated summaries let you scan your queue in a few minutes. You can pick what deserves a deep read and skip the rest. The summaries help you decide *what* to read.

Does that 25-minute article on event sourcing cover ground you already know? A two-sentence summary tells you in seconds.

Think of it as `head -20` for articles. Just enough to decide if you want to `cat` the whole thing.

## Why I built Readplace for this

I built my reading system over a decade of processing thousands of articles from r/programming, r/webdev, and HN. The pattern was always the same: save fast, read later, triage hard, keep what matters. Readplace is that system turned into a product.

The Readplace browser extension works on news.ycombinator.com. Save any article or comment thread directly from the page. One click during your morning scan, and it lands in your queue for when you have time to read.

The tab guilt goes away, the lost links go away, and the "I read something about this last week, where was it?" goes away. Just a clean list of things worth reading, ready when you are.

If your current system is "open tabs and hope," you already know it's broken. A better tool fixes it faster than more discipline ever will.
