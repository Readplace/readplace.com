---
title: "How Readplace Keeps Your Saved Links Safe From Hostile Pages"
description: "Readplace fetches every link you save on its own servers. Two guards stop a hostile page from reaching Readplace's network or slipping code into your reader, and your login now rides https only."
slug: "save-any-link-safely"
date: "2026-06-13"
author: "Fayner Brack"
keywords: "secure read it later, safe read later app, read it later security, SSRF protection, save any link safely, private read it later, DNS rebinding, XSS protection, Pocket alternative security"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Readplace fetches every link you save on its own servers, including links from sites it has not seen, which means those servers open pages I did not write and a few of those pages try something. Two guards keep them harmless. The first refuses any link pointing at a private or internal address, rechecked on every connection and every redirect, so DNS rebinding fails. The second escapes crawled page titles so a hidden script stays plain text in your reader. Sessions now ride https-only cookies. You do nothing differently, because the guards run on Readplace's side, on every save.

</div>
</details>

A read-it-later app has to fetch pages before you can read them. You paste a link, and something on the other side opens that page before it ever reaches your screen.

When you save a news feature, a recipe, a PDF, or a post from a site neither of us has seen before, Readplace opens it on its own servers and builds your clean reader view from what comes back. Most of those pages are ordinary. A few are built to use the act of fetching against the service doing the fetching, so I designed for those.

Here is what one crafted link tries to do.

## A saved link can only reach the public web

The link looks normal in your save bar. Under the hood it points somewhere it has no business going, like an internal service inside Readplace's own network that is supposed to stay off the open internet.

The sharper version of this trick hides the move in time. On the first lookup the link resolves to an ordinary public address, passes the check, and then flips to a private one a moment later when the fetcher actually connects. That swap has a name, DNS rebinding, and it has fooled plenty of services that go fetch a URL a stranger handed them.

So Readplace stopped trusting the first answer. It resolves the real address on every connection, checks the first hop, then checks again after each redirect. Loopback, private ranges, link-local addresses, all of them get refused at the door. A saved link can pull a public page and nothing else, no matter how the address shifts between the check and the fetch.

> **A link that points anywhere but the public web gets refused on every hop, not just the first one.**

## A page cannot slip code into your reader

The same lesson shows up one layer in, on the way back out to your screen.

Every page you save carries a title and a short description. Readplace drops some of that text into the structured data block, the hidden markup that search engines read to understand the article. A hostile page can tuck a snippet of script inside its own title, and if that title lands in the block raw, a browser reading the page later might run it.

Readplace rewrites the handful of characters that let text turn into markup, so a title stays a title. The words read as words, and none of it runs. That covers the public reader view as well, the page you can share without anyone logging in.

## Your login rides a locked channel

One more change sits closer to you than to any crawled page.

The cookies that keep you signed in now carry the Secure flag, so your browser only sends them back over an encrypted https connection and refuses to send them over plain http. A session cookie that leaks across an unencrypted hop is a session a stranger can borrow, and that path is closed.

```rp-figure
kind: walk
title: What a saved link meets between your save bar and your screen
note: The guards run on Readplace's side, on every save.
toggle: What each stage's guard stops
step: The first hop of the fetch | Readplace opens the page on its own servers, resolving the real address on every connection and checking the first hop | Loopback, private ranges and link-local addresses get refused at the door, so nothing is fetched from that address
step: Every redirect after it | Readplace checks the address again after each redirect, rather than trusting the first answer | The redirected hop is refused too, so a saved link pulls a public page and nothing else, no matter how the address shifts between the check and the fetch
step: The title into the structured data block | Some of the title and short description from the page you saved is dropped into the structured data block, the hidden markup that search engines read to understand the article | Readplace rewrites the handful of characters that let text turn into markup, so a script tucked inside a page title stays plain text, in your reader and in the public page you can share without anyone logging in, and none of it runs
step: The trip back to your screen | The clean reader view reaches your screen, and the cookies that keep you signed in travel back to Readplace | Those cookies carry the Secure flag, so your browser refuses to send them over plain http and only sends them back over an encrypted https connection
```

## Why this matters to you

Your saved list is a record of what you read and what you mean to read, and you trust Readplace to hold it. The plumbing that fills that list should hold to the same standard, even on a page the crawler is seeing for the first time.

None of this asks anything of you. You paste a link the way you did yesterday, the guards run on Readplace's side on every save, and you read what you saved.

Save your first link and watch the clean reader build. [Install the browser extension](https://readplace.com/install) or start at [readplace.com](/).
