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

You paste a link into a read-it-later app. A few seconds later it says: sorry, we couldn't save this. The page opens fine in your browser, so what went wrong?

Often the site blocked the app's crawler. Plenty of websites run bot protection from Cloudflare or Fastly. These services watch for traffic that looks automated, and they hand back a block page in place of the article.

Readplace used to make that worse for some pages. The old crawler fetched a page, read it, and sometimes fetched the same page again. A PDF was the common case. The first fetch treated the page as HTML, found a PDF, and gave up. The crawler then passed the same URL to a second path built for PDFs, which downloaded it from scratch.

That meant two downloads of one page. It put double the load on the website, and it doubled the odds that bot protection flagged the request and returned a block.

## Fetch once, then decide

I rebuilt the crawler around one rule. Fetch the page once, then work out what it is. The new crawler sends a single request and reads the whole body into memory one time. After that it checks the content type. HTML goes to the article parser. A PDF goes to the PDF reader. A link to X or Twitter skips the fetch and reads the post through Twitter's public oembed feed, a small endpoint that hands back the text.

One page, one request. That holds for articles, PDFs, and tweets alike.

The change helps you in two ways. Saves finish faster now, with one download in place of two. And they work more of the time. The site sees a single polite visit, not a repeat hit that trips its alarms.

There is a second part to it. When Readplace re-checks a page you saved earlier, it first asks the site whether the page changed since the last read. It sends the page's ETag and last-modified date with the request. If nothing changed, the site replies with a short 304 and no body. Readplace keeps your saved copy and skips the download. Your reading list stays fresh, and the publisher serves far less traffic.

## Saving is the hard part

Saving a page sounds simple. In day-to-day use it is the hard part of the product. The web is full of edge guards, odd content types, and sites that fight scrapers. Readplace keeps a health check for the trickiest sources. Every entry on that list traces back to a real reader who hit that wall. A broken check means I fix the crawler until the page loads again, and I do not drop the source to quiet the alarm.

## Saving should just work

Try it on the link your old app refused. Save a dense PDF, a tweet thread, a news page behind an edge guard. See if it lands in your reader, clean and readable.

[Install the browser extension](https://readplace.com/install) or [view the source on GitHub](https://github.com/Readplace/readplace.com).
