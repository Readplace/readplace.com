---
title: "Faster Pages for Readers an Ocean Away From the Server"
description: "Readplace's server sits in Sydney and most of its readers don't. A first visit from far away paid 3 round trips across the ocean before the first byte, and probes measured that cost at 660 to 955 milliseconds from the US. TLS now finishes at an edge near the reader, 1 warm connection pool sits beside the origin, and only the request itself still makes the crossing."
slug: "faster-pages-an-ocean-from-the-server"
date: "2026-08-29"
author: "Fayner Brack"
keywords: "cdn latency, time to first byte, cloudfront origin shield, tls termination at the edge, transpacific latency, read it later app speed, rate limiting behind a cdn, server-side rendering behind a cdn, connection reuse keepalive, readplace"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Opening a page from the US or Europe used to pay for its distance in round trips: a first visit crossed the ocean 3 times, for the connection, the TLS handshake, and the request itself, before Readplace's server in Sydney could send anything back. The site now answers the first 2 legs from a CloudFront edge near the reader, and after a day of cold-connection measurements, a single warm pool beside the origin carries the third. Getting there meant giving each reader back their own identity behind the edge, catching a cookie a shared cache would have replayed, and finding out that connection reuse does little for traffic too sparse to reuse anything.

</div>
</details>

Readplace runs out of Sydney. Most of the people reading it are an ocean away, in the US, the UK and Europe, and the distance was showing up in every first page load.

A browser meeting a server for the first time pays 3 round trips before any content moves: 1 opens the TCP connection, another negotiates TLS, and the last carries the request and brings back the first byte. Each of those legs ran from the reader's city to Sydney and back. The server was fast. The water wasn't.

## 2 of the 3 crossings were negotiable

The first 2 round trips carry no page. They exist so the 2 machines can agree to talk, and the agreement doesn't have to happen next to the database. readplace.com now resolves to a CloudFront edge near the reader, the handshakes finish in the reader's part of the world, and only the request itself still travels to Sydney.

The third crossing stays. The readlist is rendered per account, so the edge can't hand out a stored copy, and no setting moves Sydney closer to Chicago.

Sydney readers pay about 10 milliseconds more than before, because their requests take an extra hop through an edge they didn't need. I took that trade on purpose. The readers paying the most were the ones furthest away.

## Behind an edge, a whole city shares 1 address

The distribution wasn't the hard part of the week. Behind a CDN, the socket that reaches the origin belongs to the edge, so the address the server sees is the edge's own. Rate limits, ban decisions and [the vendor-free analytics](/blog/analytics-without-a-vendor?utm_source=blog-faster-pages-an-ocean-from-the-server&utm_medium=internal&utm_content=post-analytics-without-a-vendor) key off that address. Left as it was, every reader served by 1 point of presence would have shared a rate-limit bucket, a ban record and an analytics identity. A single heavy user could have slowed a whole region down, and banning 1 abuser would have banned the readers beside them.

So the edge states the viewer's real address in a header, and the origin believes it only when the request also carries a secret CloudFront stamps on each request it forwards. The bare origin endpoint stays publicly reachable, since that is what the edge forwards to, and a request that shows up with the header but without the proof is someone picking their own bucket. It gets ignored.

The sweep to adopt this ran on the compiler rather than on grep. The address hashing now accepts only a branded ViewerIp type, so every line that still read the socket's address stopped compiling: the rate limiter, the ban gate, bot defense, and 6 authentication paths, each moved over by hand.

## A cookie the cache would have replayed

Putting a shared cache in front of an app is also an audit of which responses were written for exactly 1 reader. The middleware that hands each visitor an anonymous id ran ahead of the static file handler, so every stylesheet and image response carried a Set-Cookie naming whoever fetched it first. Served from 1 origin to 1 browser, that was invisible. Cached at an edge, the same response would have handed the first visitor's identity to each visitor after them.

The middleware skips static assets now, and the fix landed while the distribution still carried no production traffic.

## The flip itself was 1 DNS record

Staging went first: 637 requests through the Sydney edge with no server errors, the real viewer address visible at the origin, and a forged viewer header ignored on the edge path and on the direct one. The production cutover was then 1 Route53 alias repointed at the distribution, with the old front door left standing, so rolling back is the same edit in reverse.

## The probes came back cold

The plan expected the origin leg to ride a kept-alive connection, with the handshakes to Sydney paid once and reused. I sampled the site from the US and the UK the day after the cutover, and the numbers said otherwise. 1 probe found a warm connection. The rest paid the full fresh sequence to Sydney through the edge.

| Probe origin | Fresh connection | Warm connection | Difference |
| --- | --- | --- | --- |
| US | 660 to 955 milliseconds | about 200 milliseconds | about 70 to 79% lower |
| UK | 786 to 905 milliseconds | not measured | not measured |

The cause was density, not configuration. Reuse needs a 2nd request to land on the same edge host while the 1st one's socket is still open, and Readplace's traffic, spread across dozens of edge hosts in each region, rarely lands 2 requests on the same host inside that window. Almost every edge host warmed a socket for 1 request and let it die.

> **Connection reuse pays nothing until the next request finds the last one's socket still open.**

## 1 pool warm enough to matter

CloudFront's answer to exactly this is [Origin Shield](/view/docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/origin-shield.html?utm_source=blog-faster-pages-an-ocean-from-the-server&utm_medium=internal&utm_content=read-docs-aws-amazon-com): every point of presence sends its origin fetches through 1 shield sitting beside the origin, so the sockets worth keeping warm all live in 1 pool that each region's traffic feeds. Sparse traffic through dozens of doors becomes enough traffic through 1. The rollout plan had listed Shield as the step to take only if measurements showed cold connections, and the measurements had just shown them, so it shipped the same day.

## What the wait is made of now

A first visit from far away spends its opening 2 round trips at an edge nearby and its third on a socket that stays warm between visitors. What's left of the wait is 1 crossing and the render, and the crossing is geography rather than software.

Wherever in the world you're reading this, saving a page with [the browser extension](https://readplace.com/install) and opening it in [your readlist](/?utm_source=blog-faster-pages-an-ocean-from-the-server&utm_medium=internal&utm_content=home) now costs 1 trip to Sydney instead of 3.
