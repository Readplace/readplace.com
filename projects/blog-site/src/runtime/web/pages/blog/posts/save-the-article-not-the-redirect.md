---
title: "Saving the Article Means Following the Redirect"
description: "A shortener, a Google News URL, or a newsletter tracker points at the real page through a chain of hops. Walking that chain is part of the save, and Readplace now walks it the same way on every fetch path it uses for sites that block a plain request."
slug: "save-the-article-not-the-redirect"
date: "2026-07-10"
author: "Fayner Brack"
keywords: "save article behind redirect, read it later follow redirects, save a shortened link, save google news link, save newsletter link, read it later link shortener, save the article not the tracker, crawler follow redirects, save a link that redirects, read it later save the real article"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

A shortened link, a Google News URL, or a newsletter tracker points at the real article through a chain of redirects, and saving the article means walking that chain to the end. Readplace fetches some pages through fallbacks built for sites that block a bare request: a curl subprocess, an HTTP/2 client, and a hand-built TLS request for incomplete certificate chains. None of them can hand redirect-following to the layer underneath, so the app follows redirects itself. Until now each of the three did it a little differently. The HTTP/2 and TLS paths resolved some relative redirects against the wrong base, threw on a 3xx that carried no Location instead of treating it as the final page, and carried request headers across an origin boundary the curl path would have dropped them at. Those two paths handle the pages a plain fetch already failed on, so the article behind both a block and a redirect was the one most likely to hit the weaker handling. All three share one redirect loop now: relative links resolved against the current hop, a cap of 5, http and https only, credential headers dropped on a cross-origin hop, and a 3xx with no Location returned as the final response. A single timeout budget spans the whole chain, so a slow origin can't multiply the ceiling by redirecting.

</div>
</details>

Newsletter links rarely point straight at the article. The address wraps another one, sometimes two or three deep, before the real page shows up. A shortener works the same way. Google News wraps the link before it hands it over. Any email that counts your clicks routes you through a tracker first.

Readplace saves the article, not the address you pasted. So the fetch has to walk that chain to the end. Otherwise the copy in your queue is the tracker page, not the story.

## Three fetchers, and none of them chase

When you save a link, Readplace fetches the page the way a browser would. A plain request gets the article back most of the time. Some sites hand a real browser the page and a bare script a 403. So Readplace keeps [fetchers that pose as a browser](/blog/save-articles-from-sites-that-block-bots) for the pages a plain request bounces off.

There are 3 of them. One runs [curl-impersonate](/view/github.com/lexiforest/curl-impersonate) as a subprocess, copying a browser's TLS handshake. One speaks HTTP/2 through Node's own client, for sites that read the older protocol as a bot. One builds the TLS request by hand to fetch a missing intermediate certificate when a site serves an incomplete chain.

None of the three can hand redirect-following to the thing underneath it. The curl subprocess runs with its own redirect chasing turned off, on purpose. Every hop has to be re-checked against the guard that keeps a save from reaching an internal address. The other two don't follow redirects on their own either. So the code above them walks the chain itself.

For a while, each of the three walked it in its own way.

## The same redirect, three answers

The curl path did the full job. It resolved a relative Location against the current hop, stopped after 5, and refused any hop that wasn't http or https. It dropped the cookie and authorization headers when a redirect crossed to a new origin, the way a browser does.

The HTTP/2 path did less. It resolved a relative Location against the site's root rather than the current address, so a redirect a few folders deep could land on the wrong page. A 3xx response with no Location header made it throw and fail the save, where a browser treats that response as the final one and stops. It carried the request headers straight across an origin boundary without dropping them.

The hand-built TLS path had the same gaps. Throw on a missing Location. No header drop across origins. Its own copy of the hop cap and the status-code list, a few lines that had to stay in step with two others and slowly didn't.

The pages that reached those two paths were the ones a plain request had already failed on. So the article most likely to hit the weaker handling was already behind a block, and behind a redirect too. A reader saving a piece from a bot-gating site, linked through a shortener, stood on the exact spot where the three paths disagreed.

```rp-figure
kind: matrix
title: The same redirect, three answers
note: The two weaker paths handled the pages a plain request had already failed on.
toggle: After the three copies became one loop
head: Redirect rule | curl subprocess | HTTP/2 client | Hand-built TLS
row: Relative Location resolved against | current hop>>current hop | !site's root>>current hop | !wrong base>>current hop
row: A 3xx with no Location header | ?not stated>>comes back as the final response | !throws and fails the save>>comes back as the final response | !throws>>comes back as the final response
row: Cookie and authorization headers on a cross-origin hop | dropped>>dropped | !carried straight across>>dropped | !no header drop>>dropped
row: Hop cap | stops after 5>>stops after 5 | ?not stated>>stops after 5 | !its own copy of the cap>>stops after 5
```

## One loop that owns the hop

The three copies are one function now. It takes the entry address and a way to make a single request. It owns every decision about where the redirect points: the relative Location resolved against the current hop, the cap at 5, and the http-and-https-only rule. Credential headers get dropped on a cross-origin hop, and stay dropped for the rest of the chain. A 3xx with no Location comes back as the final response, [the way fetch defines it](/view/fetch.spec.whatwg.org/), instead of throwing.

Each fetcher still passes in its own way of making the request. The curl path re-checks every hop against the internal-address guard. The HTTP/2 path opens a fresh connection per hop. The TLS path carries its certificate work through. What changed is that the choice of redirect target left the three of them and moved into one place they all call.

One more thing moved with it. The curl path builds a single timeout budget when the save starts and threads it through every hop. A slow origin that redirects 5 times can't spend 6 times the ceiling, because no hop gets a fresh clock.

> **The article behind both a block and a redirect was the one the old code was least sure how to save.**

## What a redirected link brings back

Paste a shortener, a Google News URL, or a newsletter link that buries the article behind a tracker, and the save resolves the chain to the real page and stops there. It stops the same way whether the fetch went out over curl, HTTP/2, or the hand-built request, because all three ask the same loop where to go next. The copy that lands in your queue is [the article, held at the moment it was fetched](/blog/saved-articles-outlast-the-original-page), and not the hop in front of it.

None of this shows on the page you read. A save that followed 3 redirects looks exactly like one that needed none. That is the point of it. The reader pastes an address and gets the article, and the hops it took to get there stay where they belong, out of the way.

Point Readplace at a link that hops before it lands, a newsletter tracker or a shortened URL from a site that turns away a bare fetch. Send it from [the browser extension](https://readplace.com/install) or [readplace.com](/), and see whether the copy that comes back is the article or the hop standing in front of it.
