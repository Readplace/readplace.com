---
title: "The newsletter 400s came from a User-Agent sent twice"
description: "Click links that would have failed to save with a 400 now get through the newsletter's tracker to the article they point to."
excerpt: "The tracker's 400 read like an expired link, but the request behind it was the crawler's own."
tldr: "Newsletter click links were failing to save as `fetch-failed: HTTP 400`. The 400 was the tracker's answer to a request from Readplace's own crawler. Its curl leg runs `curl_chrome131`, a curl-impersonate wrapper that already sends Chrome's User-Agent and the headers that go with it. The crawler added its own copy of the User-Agent and most of those headers, and the trackers answered 2 User-Agent lines with 400. The curl leg now leaves those headers to the wrapper, and an HTTP/2 400 moves on to the next transport. A new save of a beehiiv, HubSpot or Quora click link that Readplace can follow is stored under the article it leads to."
slug: "newsletter-400s-user-agent-sent-twice"
date: "2026-11-05"
author: "Fayner Brack"
keywords: "newsletter link failed to save, duplicate user-agent header, http 400 duplicate headers, curl-impersonate duplicate headers, curl_chrome131, click tracker 400 bad request, rfc 9110 duplicate header field, beehiiv hubspot quora click links, readplace"
---

59 saves on the failed-articles report of 1 November carried `fetch-failed: HTTP 400`, each keyed on a click tracker's URL instead of the article behind it. Opening one showed the heading "Your link is saved" and the line "Readplace couldn't load the full article from this site."

That 400 looked like an expired click link.

Readplace's crawler tries a link through a ladder of 3 transports.

Node's fetch goes first and follows redirects. Node's HTTP/2 client goes second, and curl goes last through `curl_chrome131`, a curl-impersonate wrapper that passes for Chrome 131 down to the TLS handshake.

A leg that comes back blocked hands the link to the next one. All 3 legs run first under a persona whose headers pass for Chrome. A second persona that announces the crawler as ReadplaceBot gets a turn when all 3 are blocked, and a pass through a residential proxy comes after it.

## 29 October

The first change went after the middle leg.

Node's HTTP/2 client was failing on HTTP/1.1-only trackers with `ERR_HTTP2_ERROR` and the message "Protocol error". The crawler had no class for that code, so the attempt counted as unclassified.

An unclassified failure threw away any blocked answer already in hand, so neither the second persona nor the proxy ran. The change counted `ERR_HTTP2_ERROR` as a block so the fallbacks could run.

A production recrawl of a fixed set of 60 articles gave it nothing to claim. 6 requests went through the new classification, and all 6 failed after their fallbacks.

A revert took it out of production about 87 minutes after it went live.

## 1 November

Production logs from those 87 minutes disagreed with the recrawl.

In a batch of newsletter saves on 29 October, 18 hit the protocol error and the proxy recovered 14 of them, 6 with the article's body. The 2 batches before it had the change off and recovered 0 of 38.

The change went back in.

The restore left the 400s as they were. Its own tests show why: when curl answered 400, the ladder returned that answer from the first persona and stopped there.

## `User-Agent`, twice

A reproduction with plain curl took the 400 apart, 1 link per tracker host.

The wrapper's headers alone got each tracker's redirect, and so did the persona's. Both sets together got 400, and a duplicated User-Agent alone was enough.

In production the curl leg sent both sets: the wrapper already sends Chrome's User-Agent, Accept and Accept-Language, the Sec-CH-UA and Sec-Fetch headers, and Upgrade-Insecure-Requests. `buildCurlArgs`, the function that builds curl's arguments, added the persona's copy of each as another `--header`.

[RFC 9110, section 5.3](/view/www.rfc-editor.org/rfc/rfc9110%23section-5.3) says a sender "MUST NOT generate multiple field lines with the same name in a message" unless the field's definition lets them be recombined as a comma-separated list. User-Agent's grammar is a run of product tokens and comments separated by whitespace, with no list in it.

All 59 had been saved since 29 October, and 4 tracker hosts accounted for 39 of them.

On those saves, Node's fetch had followed the tracker's redirect to a destination that answered 403 or 429, and the HTTP/2 client had failed at the HTTP/1.1-only tracker. Curl's 400 counted as an answer. The crawler stored `fetch-failed: HTTP 400` against the tracker's URL and threw the 403 or 429 away.

> **A 400 at the tracker hid a 403 or 429 at the destination.**

The fix leaves Chrome's headers to the wrapper. The curl leg now skips the 13 header names `curl_chrome131` sends on its own, Accept-Encoding and Priority among them, and passes every other header through unchanged. Referer and conditional headers such as If-None-Match still reach the origin.

Skipping them costs the ReadplaceBot persona its User-Agent on this leg, because the wrapper ties its headers to the TLS fingerprint it imitates.

With 1 User-Agent, curl gets the tracker's redirect too.

The destination's 403 or 429 now reaches the fallbacks, and the proxy pass runs when the block holds.

A follow-up on 1 November dealt with the HTTP/2 leg's own 400s, which the ladder had taken as final before curl got a turn. Production had logged 9 such answers in recrawls of failed saves, and in a local run curl-impersonate loaded 5 of 6 such links, so an HTTP/2 400 now moves on to the next transport.

## What gets saved from a tracker link now

Since 3 November, a new save of a beehiiv, HubSpot or Quora click link that Readplace can follow is stored under the article it leads to. A Quora link resolves through its redirect and a HubSpot link through the only same-host link on its fallback page. Some beehiiv links also get past their Cloudflare challenge through an egress proxy.

On 4 November, the article key stopped carrying the parameters HubSpot and Mailchimp add to each subscriber's copy of a link. An article row is keyed by its URL and shared by every reader who saves it, and those parameters used to give each subscriber's copy of a story its own row.

Not every tracker is covered.

Brevo click links aren't resolved because every sampled one landed on a feed page instead of an article.

A save made before these changes keeps its own article, and a save that already failed isn't repaired.

Tracker links in the issues that [Newsletters](/newsletters) brings in now reach the tracker with 1 User-Agent on every leg.
