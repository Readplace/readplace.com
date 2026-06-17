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

Tabs are a guilt system, not a reading system. Split discovery from reading: save HN articles to a queue during your morning scan, then read from the queue when you have time. AI summaries let you triage 30 to 40 saved articles in minutes. Readplace's browser extension works on news.ycombinator.com, and one click saves the article and generates a summary.

</div>
</details>

It's 8am, coffee in hand, and you open news.ycombinator.com. 15 minutes later you have 12 tabs open and you have not finished reading any of them.

There's a long post about SQLite page structures. Someone's war story about migrating off Kubernetes. A Show HN doing something clever with WebAssembly. A comment thread that turned out better than the article it was attached to.

You read 3 of them.

The rest sit in your tab bar for days, until you declare tab bankruptcy or your browser crashes and makes the choice for you.

If you recognise yourself in that, you are the reader I'm writing for, and I've been you for about a decade.

## The tab graveyard problem

A browser tab is a small promise you made to yourself.

12 open tabs are 12 broken promises, sitting in a row, charging you a little guilt every time you glance at them.

And HN links rot while they wait. That blog post on someone's personal site is often gone within 6 months, and that PDF on a university page can 404 by next semester.

So the tab is the worst possible place to keep something you actually want to read. It costs you guilt while it's there, and the link may die before you get to it anyway.

If something on HN is worth opening, it's worth saving somewhere that outlives the tab.

## Comments are half the value

HN behaves differently from most link aggregators, because the comment thread is often more useful than the article it sits under.

Someone posts about database indexing strategies, and 3 replies down a staff engineer at a large company drops a production war story worth more than most conference talks. That kind of knowledge tends to live only in the thread, and it disappears from your attention the moment the tab closes.

So you need to keep both the article *and* the discussion.

A tool that captures only the link throws away half of what made the post worth reading.

## What a reading workflow looks like

I spent about 10 years processing articles through r/programming, r/webdev, and HN, and I landed on a rhythm that holds up under a busy week.

**Morning scan.** A quick pass through the front page where anything that looks interesting gets saved to a queue, and nothing gets read yet.

**Lunch or commute.** The 5-to-10-minute reads. Practical posts, release announcements, short opinion pieces that fit a coffee break.

**Weekends.** The deep reads. The 30-minute technical pieces, and the long comment threads where someone patiently explains why your favourite database is the wrong choice for your workload.

> **Separate discovery from reading, and the 40-tab pileup stops happening.**

When you scan HN in the morning, your job is to triage, not to read. The reader who mixes the two ends up with 40 tabs open and almost nothing absorbed, because every promising link pulls them out of the scan and into a half-read article.

## Why a read-it-later app beats tabs

Tabs crash, links die, and you lose the context you opened them in. There's a subtler cost too: a tab bar has no sense of priority. Tabs sit in the order you opened them, and that order has no relationship to what's actually worth your next 20 minutes.

A reading queue gives you one place to go when those 20 minutes show up.

You stop hunting through tabs, and you stop trying to re-find the article you half-remember from 3 days ago, because it's already in the list.

And when an article drops off the web, and personal blogs, academic papers, and startup pages go offline often enough that you'll hit this, your saved copy still opens.

## Triage 40 articles with AI summaries

After a full week of HN browsing you might be sitting on 30 or 40 saved articles, and you are not going to read all of them.

Some seemed interesting at the time and aren't anymore. Some cover the same ground as a piece you already finished.

This is where the type of reader who saves more than they read gets stuck, because the queue starts to feel like the tab bar it replaced. AI-generated summaries break that loop by letting you scan the whole queue in a few minutes and decide what earns a deep read.

Does that 25-minute article on event sourcing cover ground you already know? A two-sentence summary answers that in seconds, and you can drop it without guilt.

Think of it as `head -20` for articles. Just enough to decide whether you want to `cat` the whole thing.

## Why I built Readplace for this

I built my reading system over a decade of processing thousands of articles from r/programming, r/webdev, and HN, and the pattern held steady the whole time: save fast, read later, triage hard, keep what matters. Readplace is that rhythm turned into a product I use myself.

The Readplace browser extension works on news.ycombinator.com, so you can save an article or a comment thread straight from the page. One click during your morning scan, and it lands in your queue for when you have time to read it properly.

Once you trust the queue, you can close the tab without feeling like you lost the article. The tab guilt goes away, the dead links stop costing you, and the "I read something about this last week, where was it?" question goes away with them.

What's left is a list of things worth reading, ready when you are.

If your current system is "open tabs and hope," some part of you already knows it's leaking. A tool that catches the link the moment you see it tends to fix that faster than another round of trying to be more disciplined.
