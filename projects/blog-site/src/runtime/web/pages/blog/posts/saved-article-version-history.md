---
title: "A Saved Article Can Hold More Than One Version"
description: "Readplace re-fetches a page you kept, and when the text comes back changed it stores that version too, dated. The reader bookmark now lists those dates newest first, with the copy you're reading marked best, and every version is held in storage that keeps them."
slug: "saved-article-version-history"
date: "2026-07-13"
author: "Fayner Brack"
keywords: "keep versions of a saved article, web page changed after I saved it, article version history read it later, save a dated copy of a page, read it later that keeps snapshots, track when a saved page changed, saved copy vs live page changes, page revision history reader, wayback machine for your reading list, read it later version log"
tags: ["changelog"]
banner: "I made the reader bookmark log each version of your copy"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Pages you save keep changing on the live web. Readplace stores your copy the moment it fetches the page, and it now stores more than one. Each time it re-fetches a saved page and the article text comes back different, it snapshots that version and stamps it with the minute it changed, then keeps every one. The reader bookmark, the small tab down the right edge that used to show a single "last crawled at" date, now lists those versions newest first. The copy you're reading sits on top with a "best" badge, and the dates under it mark the earlier versions the page moved through. Readplace cuts a version only when the words actually change, so a re-fetch that brings back the same text adds nothing to the list. The bookmark shows the older dates, and Readplace holds their snapshots, one per minute, in storage with no cap. Reading a past version back from the tab isn't wired up yet, so the reader still opens on the current copy. For now the list is a record of what the page has done since you saved it.

</div>
</details>

Fetching a saved page a second time usually brings back the same words. When it comes back changed, Readplace keeps that version too, dated, and holds on to the one it had before.

So a copy you saved is one version of a page that keeps moving. The reader shows that now, as a short stack of dates down the right edge, the copy you're reading sitting on top.

## A version only when the words change

Readplace fetches a saved page more than once. It fetches when you first save it, when a first try comes back thin and it retries, and when you save the same address again to pull a fresher copy. Most of those fetches land on the same article, unchanged since the last look.

The app compares each fetch to the copy it already holds. It hashes the cleaned article text and checks the new hash against the stored one. Same hash, same words, and nothing is recorded. A new version goes in the log only when the text is genuinely different, or when a better source wins and takes over from the one before it.

That gate is what keeps the list worth reading. Without it, every retry and re-save would stamp a fresh date on a page that never moved, and the stack would fill with copies of one version.

> **A new version is recorded only when the words come back different, not every time Readplace looks.**

## A page that reads differently in March

Say you save a framework's getting-started page in January. It lists the install steps you followed, and the copy in your readlist holds them.

In March the framework ships a new major version and someone rewrites that page. The commands change. The old steps are gone from the live web, with no note that they were ever there. Anyone who opens the address today gets the March version.

Your January copy still reads the January steps. Open it in Readplace and save the same address again, or let a recrawl reach it, and the fetch comes back with the March text. The hash differs, so Readplace records a second version and stamps it March. The bookmark shows two dates now, January under March, the newer one marked best.

Neither version wrote over the other. The page you followed in January is still the copy you followed, and the record shows the day the live page left it behind.

## Every version, nothing pruned

Each date on the bookmark points at a stored snapshot of the article as it read at that minute. Those snapshots are not pruned. The log they hang off is append-only and has no ceiling, so a page you re-save across a year builds a version for each time its text changed, and every one stays.

The bookmark draws the newest 10. That is a display limit, not a storage one. This is close to what [the Internet Archive does for a public page](/view/web.archive.org), with one difference: it keeps versions of the page for everyone, and Readplace keeps versions of the copy tied to your readlist, [the copy built to outlast the original](/blog/saved-articles-outlast-the-original-page).

> **Nothing past the tenth version is thrown away. The bookmark just stops drawing it.**

```rp-figure
kind: rule
title: What a re-fetch adds to the version log
note: The reason for the fetch never decides it. What decides it is whether the words came back different, or whether a better source took over.
choice: What the fetch brought back | The same words | Different words | A better source that takes over
choice: What made Readplace fetch again | A retry after a thin first try | You saved the same address again | A recrawl reached it
flag: The log already holds 10 versions
when: c1=1 -> no | Nothing recorded | Same hash, same words, and nothing is recorded.
when: f1 -> ok | New version, nothing pruned | The bookmark draws the newest 10. That is a display limit, not a storage one, and nothing past the tenth version is thrown away.
else: ok | New version | A new version goes in the log only when the text is genuinely different, or when a better source wins and takes over from the one before it.
```

## What you can't do with them yet

There's something worth being straight about. The older dates on the bookmark are listed, but they don't open yet. TBH... right now they sit there disabled, a record you can read but not click into. The reader still shows the current version, the one on top.

So today the feature is a log, not a way back. It tells you how many times your copy has changed and when, and it holds each version in storage against the day you can open one. That day isn't here. What is here is the record, and the snapshots behind it that make the rest possible later.

## Where the dates show up

Open an article you saved a while back and look to the right edge of the reader. If the page has changed since, and Readplace has fetched it again, more than one date sits there, the best one badged on top. If it hasn't, a single date holds, [the way it has since the bookmark first showed a capture time](/blog/saved-article-shows-when-it-was-captured).

To watch a second version land, save a page that updates often, then save the same address again once it changes, or [follow a save as it retries](/blog/watch-your-article-save-step-by-step) and comes back with different text. The bookmark grows a row. Start a readlist that keeps its own versions at [readplace.com](/), or add [the browser extension](https://readplace.com/install) and save the first page you want to hold on to.
