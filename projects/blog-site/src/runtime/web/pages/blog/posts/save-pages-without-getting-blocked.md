---
title: "How Readplace Saves a Page Without Getting Blocked"
description: "Some apps fail to save a link. They fetch the page twice and trip its bot protection. Readplace now fetches each page once, then routes HTML, PDFs, and tweets from that single download. Faster saves, fewer blocks."
slug: "save-pages-without-getting-blocked"
date: "2026-05-30"
author: "Fayner Brack"
keywords: "read it later, save articles, save web page, bot protection, cloudflare block, save pdf, conditional get, readplace, web crawler reliability"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Readplace now fetches each saved page one time. The crawler downloads the body once, checks the content type, and sends HTML, PDFs, and tweets down the right path from that single download. The old design fetched some pages twice, which raised the load on the origin site and the odds of getting blocked. One request per save means faster saves and a higher success rate on sites that guard against bots.

</div>
</details>

A reader saved a PDF report and got back the line a lot of read-it-later tools hand you when the crawler trips: sorry, we couldn't save this link.

The PDF opened fine in their browser. It opened fine in mine too. So I pulled the logs.

What I found was two fetches of the same URL inside one save. The first request pulled the page, the parser read it as HTML, saw a `%PDF` header where it wanted markup, and bailed. The crawler then handed that same URL to a separate code path built for PDFs, which opened a fresh connection and downloaded the whole file again from scratch.

Two downloads of one document.

On a plain origin nobody would notice. This report sat behind Cloudflare.

The part that took me a while to see is that Cloudflare's bot protection scores the pattern, not the single request. Two near-identical hits from the same client in the same second, the second one with no warm session from the first, reads like a script hammering the file.

The first fetch went through. The second came back as a managed challenge with a `cf-mitigated` header, and the PDF path had no way past it.

So the logs showed a clean 200 followed by a block, and the reader just saw the failure.

I had spent the first hour staring at the PDF parser. The bug was upstream of it: the crawler fetched the same URL twice.

## Fetch once, then decide what it is

I rebuilt the crawler around one rule.

Pull the body a single time, then work out what it is from what came back, not from what the URL looked like up front.

The new path sends one request and reads the whole response into memory. Then it branches on the content type. HTML goes to the article parser. A PDF goes to the PDF reader off the bytes already in hand, with no second connection. A link to X or Twitter skips the fetch, because those pages are mostly a login wall to a crawler, and instead reads the post through Twitter's public oembed endpoint, which hands back the text without the wall.

One save, one request to the origin. Articles, PDFs, and tweets all run through that single download.

> **The fix came down to one thing: making a single save cost the origin a single visit.**

Two things changed right away. Saves came back faster, because a PDF no longer paid for two round trips. And the success rate on Cloudflare and Fastly sites climbed, because the origin now sees one ordinary visit rather than a repeat hit that reads like a bot.

There was a second fetch I could cut while I was in there.

When Readplace re-checks a page you already saved, it now sends the stored ETag and last-modified date on the request. If nothing changed, the origin answers with a 304 and no body, and Readplace keeps the copy it already has. The reader gets a fresh list and the publisher serves far less traffic for the same result.

## Saving is the part that breaks

Saving a page sounds like the easy half of a read-it-later tool. In practice it is the half that fights back.

Odd content types, edge guards, sites that treat any non-browser client as an attacker. Readplace runs a health check against the sources that have broken before, and each entry on that list traces back to a real reader who hit that exact wall.

When a check goes red I fix the crawler until the page loads again, rather than dropping the source to make the alarm stop, because dropping it just moves the failure onto the next reader who saves that kind of link. What does take a source off the list is a block the crawler cannot reach from where it runs, like a site that bans the datacenter address itself, because an entry that fails every run drowns out the ones that catch real regressions.

## Try the link your last app refused

Save a dense PDF, a tweet thread, a news page sitting behind an edge guard. See whether it lands in your reader clean and readable, or whether you get the sorry-we-couldn't line.

If it lands, the one-request rule is doing its job. If it doesn't, that URL is a candidate for the health check, and I would rather hear about it than have it fail without me knowing.

Here is the lesson I took from that PDF. When a save fails behind bot protection, count how many times you touched the origin before you blame the parser.

[Install the browser extension](https://readplace.com/install) or [view the source on GitHub](https://github.com/Readplace/readplace.com).
