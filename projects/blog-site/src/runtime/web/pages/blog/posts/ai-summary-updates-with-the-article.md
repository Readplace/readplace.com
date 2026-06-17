---
title: "Your AI Summary Updates When the Article Does"
description: "Readplace keeps one TL;DR per link. When it later reads a cleaner copy of a page, it rebuilds the summary instead of serving the stale one, so your saved articles stay accurate without a manual refresh."
slug: "ai-summary-updates-with-the-article"
date: "2026-05-31"
author: "Fayner Brack"
keywords: "ai summary, article tl;dr, read it later, stale summary, summary refresh, save articles, deepseek summary, readplace"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Readplace keeps one TL;DR per link, shared across anyone who saves it. The first save sometimes grabs a thin copy of a page, like a paywall screen or a half-loaded article, and the summary matches that thin copy. Readplace re-reads pages it saved and often lands a cleaner, fuller version. It now rebuilds the summary against that better copy on its own. The refreshed TL;DR replaces the stale one for the next reader who opens that link. You get an accurate summary without asking for a refresh.

</div>
</details>

A user saved a long news article on a Monday and then emailed me, because the TL;DR on his saved card read like two lines, as if Readplace had only ever seen the headline and one stray paragraph. He opened the card and the full article was sitting right there, every word of it. The summary and the page disagreed, and at first I had no idea why.

I pulled the saved row.

The content grade on the first crawl was low, the body was a thin stub, and the summary had been written against that body. The summary was correct. It was just correct about a copy of the page nobody could see anymore.

What had happened is that the site served a stripped page to the first fetch. That can be a paywall teaser, a bot guard handing back a near-empty shell, or a slow page that drops the connection halfway through the body before the rest arrives. Readplace summarised whatever it got, which on that Monday was the shell.

Then I remembered the part of my own system I had stopped thinking about. Readplace does not stop at the first read. It re-checks saved pages on a schedule, grades each copy it pulls, and a fuller, cleaner copy outranks a thin one, so when the better copy of that news article eventually arrived, Readplace swapped it in as the version the user read. The page had upgraded under the summary while the summary stayed put.

> **The summary cached the first copy of a page and stayed pinned there even after a better copy replaced it.**

The old TL;DR sat on top of the clean copy, built from a body that no longer existed, which meant the user was reading the full article next to a two-line summary of a shell that had been thrown away. That was the bug.

## Tracking down where the summary fell behind

I traced the swap first.

When a re-crawl lands a better copy, the row already records it. A new content grade counts as a change, and so does a real edit to the text. The piece I was missing was a signal that said, this link has a better copy now, go look at the summary again.

So I added one. A separate worker listens for that signal, checks that the clean copy is actually readable, clears the stale TL;DR, and asks for a fresh one. The same DeepSeek step that wrote the first summary runs again, this time against the better copy. If you want the full picture of that step, read [how AI TL;DR actually works in Readplace](/blog/how-ai-tldr-actually-works).

Readplace caches one summary per link, shared across anyone who saves it, so the rebuilt TL;DR lands for the next reader who opens that link too.

Then I hit a second case that the first fix did not cover.

A thin first copy can be short enough that Readplace skips the summary step outright and tags the link "too short to summarise". The page later upgrades to the full article, now long enough to summarise well, but my new worker ignored it, because it only looked at links that already had a summary to rebuild. The link was tagged as skipped, so it stayed skipped. I had to widen the trigger to cover the upgrade-from-nothing path, where the summary the crawler passed on during the first read finally gets written against the full article.

## Why this mattered for the queue

A summary you cannot trust is worse than no summary at all.

You glance at a two-line TL;DR, decide the piece is light, and skip something worth your time. The reverse hurts too, when a broken summary makes a quick read look like a wall of text you do not have time for.

I built the TL;DR as a triage tool, there to help you pick what to read and when, and that job only works if the summary describes the article in front of you rather than a stale copy the crawler happened to catch on a bad morning.

This rides on top of the re-read system that was already there. Readplace asks a site whether a page changed before pulling it again, which keeps your list current and spares the publisher the traffic. Read more on that in [how Readplace saves a page without getting blocked](/blog/save-pages-without-getting-blocked).

## Try it on a stubborn save

Save an article that fought the crawler the first time, like a news page behind a soft wall or a slow longread. Give Readplace a beat to re-read it on its schedule, then open the card and check the TL;DR against the full text. It should describe the article you actually get, not the shell the site served on the first fetch.

The lesson I took from this one is small. If you cache a derived thing like a summary, you have to invalidate it on every input change, not only the inputs you remembered to wire up the first time around.

[Create an account](https://readplace.com) or [view the source on GitHub](https://github.com/Readplace/readplace.com).
