---
title: "The Crawler Already Owned the Refresh"
description: "Re-saving an article Readplace already had used to run a full page crawl inside the request, so you waited on a fresh fetch of the origin. The site's save now records the link and hands the refresh to the background job that already owns it: two reads and one message in place of the crawl."
slug: "the-crawler-already-owned-the-refresh"
date: "2026-07-30"
author: "Fayner Brack"
keywords: "fast read it later save, instant save article, why is saving an article slow, re-save read it later, save article without waiting, read it later app performance, idempotent refresh pipeline, async crawl read it later, move work off the save path, pocket alternative fast save"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Re-saving a link Readplace already had used to run a full page crawl inside the request: it went out to the origin, parsed the page again, and wrote the copy back to storage before it answered you. Readplace already runs a separate background job whose only purpose is to refresh an article once its saved copy goes stale, and that job is idempotent, so running it a second time lands where the first run did. The site's save now does none of that work itself. It records your save, and when the article is settled but stale it publishes one event that hands the refresh to that background job. A re-save that used to cost a full origin fetch now costs two reads and one message. Nothing you see changed but the wait: the card is back at the top of your queue right away, and the fresh copy lands when the job catches up. The newsletter pipeline and the browser extension already saved this way. The save bar on the site was the last one still doing the crawl in front of you.

</div>
</details>

Every save on the Readplace website runs through one accept step. On a re-save of an article whose stored copy had gone stale, that step used to turn into a full web crawl before it would answer you.

A crawl of a live page is not cheap. The server reaches the origin, waits for the bytes, runs the page through a readability parse, and writes the clean copy to storage. All of that ran inside your save request. You clicked save on something Readplace already had, and the request sat on a fresh fetch of the origin before it came back.

Re-saving isn't rare. A newsletter drops a link you kept last week, and saving it again moves it back to the top of your queue. You hit save on a page you filed months ago. Each of those went down the slow path whenever the stored copy had aged past its freshness limit.

Readplace already runs a background job whose only purpose is that refresh. It picks up an article once its saved copy goes stale, fetches the page, parses it, and stores the new copy, on its own time and well after any save. The job is [idempotent](/view/en.wikipedia.org/wiki/Idempotence), so running it twice on the same article leaves the result the first run would have. The save request was doing that job a second time, in the foreground, while you waited.

> **The refresh already had an owner, and the request was redoing its work in front of you.**

## The crawl inside the request

The accept step has one thing it must finish before it can answer: record that you saved the link. Your card can't appear in the queue until the row exists. Everything past that, the fresh copy of the page included, can happen after the response goes out.

The old code didn't draw that line. When it found an existing article whose content had aged past the stale limit, it ran the whole crawl right there, then answered. The refresh was correct. Its place was wrong. It sat on the one path a person waits on, to produce a copy the background job would have produced anyway.

## Two reads and a hand-off

Now the accept step looks, and hands off. It reads whether the article is already saved, and reads whether its crawl has settled. If the article is settled but stale, it publishes one event asking the background job to run its stale check, and returns. Two reads and one message, in place of a full origin fetch.

The event is safe to send because the job on the other end owns the refresh and doesn't mind being asked twice. Save the same stale article from two places at once, and both saves ask the same job to run. Running it once or running it twice reaches the same copy, so nothing has to coordinate the two requests.

A brand-new link, or one whose first crawl hasn't finished, still takes the path that starts a fresh fetch, the way a first save always has. The change is narrow on purpose. It lifts the crawl out of the one case that was redoing settled work, and leaves the first save of a genuinely new page alone.

There was a smaller cost on the same path, so it went too. Once the row is written, the accept step has three independent things left: mark the article unread if you'd read it, stamp the fetch time, and publish that the link was saved. They used to run one after another. They run together now. The save itself still runs first and alone, because starting the crawl bookkeeping beside a save that might fail would leave crawl state pointing at a row that was never created.

> **A save request should own only the work that has to finish before it answers.**

## Save something you already saved

Open a page you kept a few months back and save it again from the site. The card returns to the top of your queue right away, and the clean copy updates a moment later when the background job catches up. The newsletter pipeline and the [browser extension](https://readplace.com/install) already saved through a hand-off like this one. The save bar on the site was the last place still waiting on the crawl, and now it doesn't.

Crawling inside the request made the save look thorough. Handing the crawl to the job that already owns it makes the save fast and fetches the page just as fresh. A queue to watch it in starts at [readplace.com](/).
