---
title: "You Don't Need an Analytics Vendor to Count Pageviews"
description: "The HTTP request already contains the fields that matter. The rest is a hash function and a log line, not a third-party tracker and a consent banner."
slug: "analytics-without-a-vendor"
date: "2026-05-06"
author: "Fayner Brack"
keywords: "privacy analytics, cookieless analytics, IP hashing, read it later privacy, Google Analytics alternative, privacy first, visitor hash"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Readplace counts pageviews without cookies, third-party scripts, or a consent banner. An Express middleware hashes each visitor's IP with a secret salt (SHA-256, truncated to 16 chars) and logs a JSON line to stdout. The same IP yields the same hash, so distinct visitors are countable, and because the hash is one-way it cannot be reversed into an IP. The logs flow to CloudWatch and the dashboard ships as infrastructure-as-code. About 80 lines of TypeScript stand in for an analytics vendor.

</div>
</details>

I had a Hacker News post climbing the front page and no idea whether it was sending real readers or the same dozen people hitting refresh. Readplace runs without third-party analytics, without cookies, and without a consent banner, which is the privacy story I wanted to keep. It also meant I had nothing to look at while the traffic spiked.

So I had a decision to make under a little pressure, and I made the obvious wrong move first.

I started copying a Google Analytics snippet into the head of the marketing site.

I got about as far as the script tag before stopping.

> The server already has the data. The vendor just sells you the interface.

Readplace stores what people read. Pasting a tracker onto the front door of an app built on that promise would have turned the promise into a line of copy.

I deleted the snippet.

Then I went back to first principles and looked at what a single request already hands me. Here is the log line I ended up with:

```json
{
  "stream": "analytics",
  "event": "pageview",
  "path": "/",
  "utm_source": "hackernews",
  "referrer_host": "news.ycombinator.com",
  "visitor_hash": "b56e9aa95cabdf99",
  "user_agent": "Mozilla/5.0 ..."
}
```

Every field on that line falls out of the HTTP request without any extra work. The path is the path. The UTM parameters sit in the landing URL, the referrer sits in the `Referer` header, the user agent sits in the `User-Agent` header, and the IP address is part of the TCP connection itself.

Only one field needed design work, and it was the one that nearly sent me back to the vendor.

## The visitor hash was the only hard part

The question I actually had was simple to state. Were those 100 pageviews coming from 100 people, or from 3 people refreshing a tab?

That is the entire job of a unique-visitor identifier, and most tools do it with a cookie. They drop a first-party or third-party identifier on the browser and recognise it on the next request, so the cookie becomes the identity. I had ruled cookies out an hour earlier, so I needed the count without the cookie.

My first attempt was to log the raw IP and count distinct values in the query. That works, and it also parks a list of every visitor's IP address in CloudWatch, which is the same surveillance I had just deleted from the marketing site, only worse because now I owned the storage.

So I reached for a salted hash instead.

Take the visitor's IP, add a secret salt that lives only on the server, run SHA-256 over the result, then truncate to 16 characters.

The output is a string like `b56e9aa95cabdf99`. The same IP produces the same string, so the count works. A different IP produces a different string, and the hash is one-way, so the logs cannot be turned back into IP addresses. Because the salt stays on the server, guessing an IP does not reproduce the hash either.

That was the whole identity system, and it came out to 6 lines of code.

## Then the numbers looked wrong

The first night the dashboard ran, the unique-visitor count was lower than I expected for the traffic I could see in the access logs. I assumed the hash had a bug.

It did not. I had forgotten what the hash measures.

Devices on the same office Wi-Fi collapse into one hash. A corporate VPN routes its users through a single exit node and produces a single hash. A reader on mobile and the same reader on home broadband show up as 2 different visitors, because they arrive on 2 different IPs.

The hash counts network endpoints, not human beings, and once I stopped treating it as a headcount the numbers made sense.

For marketing questions that resolution is plenty. A Hacker News post either drove 100 clicks or 5, a blog either sends real readers or it does not, and the hash tells those cases apart.

What it cannot do is tell me a specific person came back on Tuesday. It does not follow people across sessions and it does not survive a change of network, which felt like a gap at 1am and felt like the point by morning.

> The hash is less precise than cookie analytics, and it answers the questions I actually had.

Those are the only questions a product that stores what its users read has any business asking.

## Matching the analytics to the product

Reading habits are personal. What you save reveals what you worry about, what you want to learn, and sometimes what you are hiding from, so a read-it-later app holds a fairly detailed portrait of someone's inner life.

An analytics stack that fights that privacy model is worse than having no analytics at all. A marketing site shipping a third-party tracker would contradict the one thing the product is supposed to protect.

The rule I kept after that night was to collect the smallest amount of data that answers the question, and nothing past it.

## The implementation stayed boring

The logs flow to CloudWatch through the standard Lambda log pipeline, and the dashboard ships as infrastructure-as-code alongside the rest of the app. Bot filtering lives in the dashboard query rather than the middleware, so I can change the filter without a redeploy, which mattered the week a scraper skewed one of the referrer charts.

There is no vendor SDK, no platform login, and no contract to renew.

Adding a new metric is one field on the log line and one widget on the dashboard.

The shape of it is portable if you want to copy it. Write a middleware that reads the HTTP headers you already receive, hash the IP with a secret salt, log a JSON object, and point your cloud provider's log query tool at the output.

The lesson I took from that Hacker News night is small. Before you pay a vendor to count pageviews, check how much of the answer is already sitting in the request, because for the questions I had it was almost all of it.
