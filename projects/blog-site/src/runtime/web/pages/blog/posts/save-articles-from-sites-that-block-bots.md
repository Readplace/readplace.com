---
title: "The 403 That Only the Crawler Got"
description: "A saved link from a normally reliable site came back empty while the same page opened in a browser. Readplace's crawler impersonated Chrome 116, whose TLS fingerprint had aged off the list of current browsers that anti-bot edges allow, so it read as a bot. Switching the persona to Chrome 131 turned those sites from 403 back to 200."
slug: "save-articles-from-sites-that-block-bots"
date: "2026-07-02"
author: "Fayner Brack"
keywords: "save article blocked by bot protection, read it later 403 error, couldn't pull the article text, TLS fingerprint JA3, curl-impersonate chrome 131, crawler blocked by Fastly, read it later that saves protected sites, save link that will not load, anti-bot 403, Readplace crawler"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Some sites hand a full page to a browser and a 403 to a crawler, even when both run from the same machine. That is what started happening to saved links Readplace pulled from The Hill, StackOverflow, and other sites behind anti-bot edges. The crawler impersonated Chrome 116, and that browser's TLS fingerprint had aged off the allowlist those edges check, so the fetch read as a bot instead of a browser. Bumping the crawler to pose as Chrome 131 turned those sites from 403 back to 200, checked against every source in the crawler's health canary with no regressions. One site, The Hill, still blocks the datacenter address itself, which no fingerprint change reaches.

</div>
</details>

StackOverflow returned the full page to a browser and a 403 to our crawler. The two requests left the same machine on the same network, seconds apart. The reader showed the message it puts up when a save comes back empty: We couldn't pull the article text.

That message had started appearing on sites that saved fine for months. The Hill was the one that tipped me off, because a reader tried to keep a piece from it and got the empty version instead of the article.

The confusing part was that nothing about the request had changed on our side.

## Not the IP, and not the headers

My first guess was the address. Cloud crawlers run from datacenter IP ranges, and some sites block those on sight. But this crawl ran from a residential address, and a browser on that same address loaded the page. So the block was not about where the request came from.

Headers were the next guess. The crawler sent a normal Chrome user-agent and the usual accept headers. I copied them into a browser and the page still loaded. I stripped them back and the crawler still got 403. The 403 did not care what the request said it was.

> **The block was not on who we were. It was on what we looked like.**

## A fingerprint that aged out

The block keyed on the TLS handshake. Before any HTTP header is sent, the client and the server negotiate encryption, and the exact shape of that negotiation, the cipher list and the extensions and the order they arrive in, is specific enough to name the software making the request. The fingerprint of that handshake has a name, [JA3](/view/github.com/salesforce/ja3). Anti-bot services like Fastly read it, compare it against the handshakes that current browsers produce, and drop the ones that do not match.

Our crawler used [curl-impersonate](/view/github.com/lexiforest/curl-impersonate), a build of curl that copies a real browser's handshake so a server sees a browser and not a script. It was pinned to a persona of Chrome 116. Chrome 116 shipped in 2023. Three years on, an edge that gates on current-browser fingerprints reads a Chrome 116 handshake as one no shipping browser produces, which is to say a bot.

> **Chrome 116 shipped in 2023. To a 2026 anti-bot edge, a client that still fingerprints as Chrome 116 reads as a bot.**

## Posing as a browser people still run

The fix was to move the impersonation forward. curl-impersonate had gone from the version we pinned, 0.8.0, to 1.5.6, and the newer release carries a Chrome 131 persona. That release also renamed the binary, from curl-impersonate-chrome to curl-impersonate, so the layer build and the Dockerfile that ship it to our crawler Lambda had to track the rename along with the version.

I built the real Linux 1.5.6 binary into the Lambda image and ran the same URLs through it. From one residential address, Chrome 116 got 403 and Chrome 131 got 200 on The Hill, on StackOverflow, and on LinkedIn.

## What Chrome 131 fixed, and what it did not

Before shipping, I ran the new fingerprint against every source in the crawler's health canary, the list of URL shapes that each broke a real save at some point. Chrome 131 passed all of them and regressed none. It is a straight upgrade over 116.

Then production drew the line of what a fingerprint can do. StackOverflow, which had been 403 from the Lambda on Chrome 116, crawled cleanly on Chrome 131. The Hill did not. From a residential address the same binary loaded it, but from the Lambda's datacenter address it still returned 403. The Hill blocks the AWS egress range on top of the fingerprint check, and no handshake change reaches that. Getting past it needs a residential or mobile proxy, which is separate work. So the fingerprint fix shipped and The Hill came off the canary until that egress piece lands, because a canary that fails every run is noise.

```rp-figure
kind: matrix
title: What the Chrome 131 persona reached, and what it did not
note: Each site checked from one residential address and from the crawler Lambda.
toggle: After the crawler posed as Chrome 131 instead of Chrome 116
head: Check | The Hill | StackOverflow
row: Fetch from one residential address | !403>>200 | !403>>200
row: Crawl from the Lambda's datacenter address | !403>>Still 403 | !403>>Crawled cleanly
row: What still blocks it | !Fingerprint plus the AWS egress range>>The AWS egress range | !Fingerprint>>Nothing
```

## Saving the links a bare fetch bounces off

A read-it-later tool is only as good as the saves it completes. The sites most worth keeping, the news and reference and discussion ones, are also the sites most likely to sit behind an anti-bot edge. A plain download gets a 403 there, and the reader gets an apology instead of the article. Matching a current browser's handshake is what turns that 403 into the text.

Fingerprints age. A browser persona that clears every edge today reads as stale a year or two on, which is why the canary now sweeps the fingerprint across every source and trips CI before a reader ever meets the empty version.

Point it at a link a plain download would bounce off: [install the browser extension](https://readplace.com/install), or paste the link at [readplace.com](/), and see whether it comes back as clean reading.
