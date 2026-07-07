---
title: "A Saved Article Should Carry Its Own Date"
description: "Readplace now shows when each saved copy was captured. A small bookmark rides the right edge of the reader with the date and time it fetched your copy, written in UTC so it reads without JavaScript and rewritten into your own time zone. The live page can change with no note, but the copy holds still at a moment you can now see."
slug: "saved-article-shows-when-it-was-captured"
date: "2026-07-07"
author: "Fayner Brack"
keywords: "when was this article saved, read it later snapshot date, saved article timestamp, read later copy date, article archive date, when was this page captured, saved copy vs live page, read it later that keeps a dated copy, article snapshot time zone, last crawled at"
tags: ["changelog"]
banner: "I added a bookmark that shows when your copy was taken"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Open any article in the Readplace reader and a small bookmark now rides the right edge, showing when your copy was captured. It reads Last crawled at, with the date and time Readplace fetched the page and built your reader view. The server writes that time in UTC so it reads without JavaScript, and a script rewrites it into your own time zone. On a wide screen the bookmark sits open. On a phone it folds to a thin handle you tap to expand. The live page can change or vanish with no note, but the copy holds at a moment you can now see, and if Readplace fetches the page again the date moves to the newer capture.

</div>
</details>

Web pages change after they go up, and they rarely date the change. A story gets corrected a day later, or a paragraph disappears, or the whole page starts returning a 404. Nothing on it says when, so the version you read last month is just gone.

A saved copy holds still while that happens. Readplace stores the article as it was the second it fetched the page, and [that copy stays put](/blog/saved-articles-outlast-the-original-page) while the live one drifts or disappears.

**The copy always had its date underneath. The reader just never showed it.**

## What the bookmark shows

Open a saved article and a small tab now rides the right edge of the reader, about a third of the way down. It reads Last crawled at, then a date and a time. That is the moment Readplace fetched your copy and cleaned it into the reader view.

The time is yours, not the server's. Readplace writes it once in UTC, so it reads correctly even with no script running. A small script then rewrites it into the time zone your browser reports, so the date on the bookmark is the date where you are.

On a wide screen the tab sits open, the date in view. On a phone it folds down to a thin handle against the edge, clear of the text. Tap the handle and it opens. Tap it again and it closes.

If Readplace ever fetches the page again, [say a first save came back empty and retried](/blog/watch-your-article-save-step-by-step), the bookmark moves to the newer time. It names the copy you are actually reading, not the first attempt at it.

## The date the live page won't give you

A snapshot without a date is just an old page you are unsure of. You can't tell if it is this morning's version or one from a year ago, and you can't tell what the original has done since.

Say you saved a news story the day it broke. A week later the site revised two of its figures, with no note on the page. Your copy still holds the first version, and the bookmark shows the day you took it. So you know which version you are reading, and roughly when it was the live one.

> **A dated snapshot is a record. An undated one is just an old page you are not sure about.**

The date is also a fact Readplace is not hiding. It tells you how fresh your copy is, in the open, instead of letting an old capture pass for current. If a piece is six months stale, the bookmark says so, and you can save it again to pull a newer copy.

## When the copy is the one you keep

A read-it-later tool holds things you mean to come back to. Some of them you come back to a year later. By then the original may have moved or gone, and the copy on Readplace is the one you have left.

A copy you keep that long has to be one you can place in time. The bookmark is what places it. It turns a page you are half sure about into one you can date and point to. Send a saved link to someone, or lean on it to settle a question, and the capture time rides along on it.

## Read a saved piece and check its date

The bookmark shows up on every article you open in the Readplace reader, on the web and in the [iPhone app](/blog/read-saved-articles-in-the-iphone-app). You don't switch it on. It is already there on the copies you have saved.

Open something you already saved at [readplace.com](/), or save a fresh page with [the browser extension](https://readplace.com/install), then look to the right edge of the reader for the day your copy was taken.

A page on the open web tells you when it was published, if it tells you anything. A copy on Readplace tells you when it became yours.
