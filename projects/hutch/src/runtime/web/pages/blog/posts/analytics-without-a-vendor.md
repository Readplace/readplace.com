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

Readplace tracks pageviews without cookies, third-party scripts, or consent banners. An Express middleware hashes each visitor's IP with a secret salt (SHA-256, truncated to 16 chars) and logs a JSON line to stdout. Same IP produces the same hash, so distinct visitors are countable, and the hash is one-way and cannot be reversed into an IP. The logs flow to CloudWatch. The dashboard is infrastructure-as-code. About eighty lines of TypeScript replace an analytics vendor.

</div>
</details>

Every web server sees its own traffic. Analytics vendors package that data as a dashboard and charge for it.

Most sites pay for the dashboard with surveillance. Cookies on the visitor. Third-party scripts in the browser. Identifiers that follow people between sites they did not ask to connect.

> The server has the data. The vendor has the interface.

Readplace runs without any third-party analytics, cookies, or consent banner. The whole system is an Express middleware that writes JSON to stdout. About eighty lines of TypeScript.

Here is one log line:

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

Every field on that line comes straight out of the HTTP request. The path is the path. The UTM parameters sit in the landing URL. The referrer sits in the `Referer` header. The user agent sits in the `User-Agent` header. The IP address is part of the TCP connection.

Only `visitor_hash` required design work.

## The visitor hash is the whole trick

I want to tell 100 pageviews from 100 people apart from 100 pageviews from three people refreshing. That is the single job of a unique-visitor identifier.

Most analytics tools do that job with a cookie. They drop a first-party or third-party identifier on the visitor and recognise it on each new request. The cookie is the identity.

Readplace does it with a salted hash. Take the visitor's IP address. Add a secret salt that lives only on the server. Run SHA-256 over the result. Truncate to sixteen characters.

The output is a string like `b56e9aa95cabdf99`. The same IP produces the same string, so the system can count distinct visitors. A different IP produces a different string.

The hash is one-way. The logs cannot be reversed into IP addresses. The salt is secret, so guessing an IP does not reproduce the hash.

That is the whole identity system. Six lines of code.

## The hash counts endpoints, not people

Devices on the same office Wi-Fi collapse into one hash. A corporate VPN routes its users through one exit node and produces one hash. A visitor on mobile and the same visitor on home broadband look like two different visitors.

For marketing analytics, that resolution is enough. A Hacker News post either drove a hundred clicks or five. A blog either sends real readers or does not. The hash distinguishes the cases.

It cannot tell me a specific person came back on Tuesday. It does not follow people across sessions. It does not survive a change of network.

> The data is less precise than cookie-based analytics. It answers the questions I actually have.

Those are the questions analytics should answer on a product that stores what its users read.

## The analytics model has to match the product model

Reading habits are personal. What you save reveals what you worry about and what you want to learn. Sometimes it reveals what you are hiding from.

A read-it-later app holds a detailed portrait of its user's inner life.

An analytics stack that contradicts that privacy model is worse than no analytics. A marketing site shipping Google Analytics turns a privacy promise into a marketing line.

Collect the minimum data that answers the question. Nothing more.

## The implementation is boring on purpose

The logs flow to CloudWatch through the standard Lambda log pipeline. The dashboard ships as infrastructure-as-code alongside the rest of the application. Bot filtering lives in the dashboard query, not in the middleware, so the filter changes without a redeploy.

There is no vendor SDK, no analytics platform, no contract to renew. Adding a new metric is a field on the log line and a widget on the dashboard.

The approach is portable. Write a middleware that reads the HTTP headers you already have. Hash the IP with a secret salt.

Log a JSON object. Point your cloud provider's log query tool at the output.

Prefer writing a middleware over paying a vendor to count pageviews.
