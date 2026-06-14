---
title: "How Readplace Keeps Your Saved Links Safe From Hostile Pages"
description: "Readplace fetches every link you save on its own servers. Two guards stop a hostile page from reaching our network or slipping code into your reader, and your login now rides https only."
slug: "save-any-link-safely"
date: "2026-06-13"
author: "Fayner Brack"
keywords: "secure read it later, safe read later app, read it later security, SSRF protection, save any link safely, private read it later, DNS rebinding, XSS protection, Pocket alternative security"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Readplace fetches every link you save on its own servers, including links from sites it has not seen. That means our servers open pages we did not write, and a few of those pages try something. Two guards keep them harmless. The first refuses any link that points at a private or internal address, checked on every connection and every redirect, so DNS rebinding fails. The second escapes crawled page titles so a hidden script stays plain text in your reader. Sessions now ride https-only cookies. You do nothing differently. The guards run on our side, on every save.

</div>
</details>

You save links from all over the web. A news feature, a recipe, a PDF, a post from a site neither of us has seen before. Readplace fetches each one on its own servers and builds your clean reader view from it.

That means our servers open pages we did not write. Most are ordinary. A few are not. A handful of pages try to use the act of fetching against the service that fetches them. We added two guards so a hostile page stays harmless, and your saved reading stays yours.

## A saved link can only reach the public web

A normal link points at a public website. A crafted link can point somewhere else: an address inside our own network, like an internal service that should stay off the open internet.

Some attempts hide the move. The link resolves to a public address on the first check, then flips to a private one a moment later. The trick has a name, DNS rebinding, and it has fooled plenty of services that fetch user-supplied URLs.

Readplace now checks the true address on every connection. It checks the first hop, and it checks again after every redirect. Loopback, private ranges, link-local addresses, all of them get refused. A saved link can pull a public page and nothing more.

## A page cannot slip code into your reader

Every page you save carries a title and a short description. Readplace places some of that text into structured data, the hidden block that search engines read to understand the article.

A page can hide a snippet of script inside its own title. Drop it into the structured block raw, and a browser might run it. So Readplace rewrites the few characters that let text turn into code. The title still reads as words. None of it runs.

That fix covers the public reader view too, the page you can share without a login. The words from a crawled page show up as words, every time.

## Your login rides a locked channel

One more change. The cookies that keep you signed in now carry the Secure flag on https. The browser sends them back over encrypted connections and nowhere else. A session cookie that leaks over plain http is a session someone else can borrow, and that door is now shut.

## Why this matters to you

A read-it-later app holds a quiet record of what you read and what you mean to read. You trust it with that list. The plumbing that fills the list should earn the same trust.

None of this asks anything of you. You paste a link the same way as before. The guards run on our side, on every save, and you never see them work. That is the point.

Save your first link and watch the clean reader build. [Install the browser extension](https://readplace.com/install) or start at [readplace.com](/).
