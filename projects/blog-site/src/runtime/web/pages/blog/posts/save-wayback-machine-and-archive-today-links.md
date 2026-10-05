---
title: "A Wayback Machine link now saves the article it preserves"
description: "The only copy left of a vanished page is often the one an archive kept. A Wayback Machine or archive.today link pasted into Readplace now saves the article the capture preserves, filed under its original address. The live page still gets crawled, the more complete copy is the one the reader shows, and when the original stops answering, the capture is the article."
slug: "save-wayback-machine-and-archive-today-links"
date: "2026-10-05"
author: "Fayner Brack"
keywords: "save wayback machine article, wayback machine read it later, archive.today reader, save archived web pages, link rot reading list, read dead links later, web.archive.org save link, archive.ph read later, readplace"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

A page that no longer loads often survives as a capture on web.archive.org or archive.today. That capture's link now saves in Readplace as the article it preserves: filed under the original address, crawled alongside the live page, with the more complete copy ending up in the reader. When the original is gone, the capture is the body you read. The calendar page, the mirror hosts and the short ids all resolve to the same article, so whichever link the archive hands out is the one that works.

</div>
</details>

49 words. That is the size of the article Readplace used to store when a save arrived through the Wayback Machine's calendar page, the URL the archive's own interface leaves in the address bar. Behind that link sat a full capture of the page being looked up. The stored copy was a grid of dates with a title on top.

Timestamped capture links had the opposite problem. The save went through, but the capture got pinned as the article's only source, so the snapshot stood in for the live page from then on and no later crawl asked the original again.

Both failures are gone. An archive link now saves the article it preserves, and the capture becomes 1 more candidate copy instead of the only one.

## The address inside the address

An archive link carries the article's address in plain sight. `web.archive.org/web/20230415000000/https://example.com/essay` is 1 address wrapped around another, and the inner one is the article. The save now reads it out of the shapes the 2 big archives produce: the timestamped capture, the calendar page, the `/newest/` and `/oldest/` forms, inner addresses that arrive percent-encoded or stripped of their scheme, and all 7 hosts archive.today answers on, archive.ph through archive.vn.

> **An archive link is 2 addresses in 1, and the inner one is the article.**

An archive.today short id has no inner address at all. A link like `archive.ph/x9Kbz` names a capture and nothing else, so the save asks the archive which page the capture holds, following the redirect when 1 mirror hands the id to another, and files under the answer.

That filing is the point. The entry lands with the article's own title and its own site, not under the archive's name. A capture saved today joins the entry the live link created last year, rather than sitting beside it as a 2nd copy of the same piece.

## The capture competes with the live page

Pinning the capture as the only source was the old mistake, so the new behaviour is built not to repeat it. A save of an archive link crawls 2 things: the live page, as any save does, and the capture, as a copy in its own right. The judge that already weighs a browser extension's capture against the crawl weighs this copy too, and the most complete one is what the reader shows.

The rules lean toward the living page on purpose. A tie keeps the live crawl, and a capture can't win on its images alone. A snapshot from 2019 has to beat today's page on text before it shadows anything. When it does, that says something about today's page: the body went thin, or moved behind a paywall.

## When the original stops answering

The strongest case is the page with nothing live left to crawl. When the live fetch comes back failed, not found, or blocked, the save builds the article from the recorded capture instead, and a recrawl months later falls back the same way. A piece that survives only on [web.archive.org](/view/web.archive.org?utm_source=blog-save-wayback-machine-and-archive-today-links&utm_medium=internal&utm_content=read-web-archive-org) still turns into a clean, summarized article in the readlist.

Saved copies outliving their pages is old ground here, argued in [Read It Later, Even After the Original Page Is Gone](/blog/saved-articles-outlast-the-original-page?utm_source=blog-save-wayback-machine-and-archive-today-links&utm_medium=internal&utm_content=post-saved-articles-outlast-the-original-page). That protection starts at the save, though, so the page that died first sat outside it. The archive kept the only copy of those. Now that copy has a way in.

## Paste the capture you settled for

A reference chase tends to end on a tab like this: the piece a thread swore by, 404 at its own address, alive only because someone captured it in time. That link used to be the awkward one in a readlist. Save it now from [the browser extension](https://readplace.com/install), the save bar, an import file or a connected assistant, and the entry that appears carries the article's name, not the archive's.

When a trail dead-ends at a 404 and the detour goes through the Wayback Machine, what the detour finds can come straight back to [readplace.com](/?utm_source=blog-save-wayback-machine-and-archive-today-links&utm_medium=internal&utm_content=home), summarized and filed as though it had been reachable all along.
