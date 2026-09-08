---
title: "One share, every readlist it belongs in"
description: "A link that belongs in 2 readlists used to mean saving it twice. The iPhone app now asks once which lists shared articles should drop into, accepts more than one answer, and files each share into all of them through a single request. The app also opens on the readlist you left it on and switches to the rest from a menu."
slug: "one-share-every-readlist-it-belongs-in"
date: "2026-09-07"
author: "Fayner Brack"
keywords: "save to multiple reading lists, ios share sheet save article, share a link to a reading list iphone, readlist iphone app, read it later ios, save one link to several lists, pocket alternative iphone, readplace"
tags: ["changelog"]
banner: "I taught the iPhone share sheet where your links belong"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

From the iPhone share sheet, one save can now drop a link into several readlists at once. The Readplace app asks on the first share which lists shared articles should land in, keeps the answer on the account, and lets you change it from a checkbox on any list. The app itself now opens on the readlist you left it on and switches to the others from a menu. Every confirmation names where the link went, so "Saved to 'Work'" becomes "Saved to 'Work' and 'Recipes'".

</div>
</details>

"The rail hasn't made that trip yet, so creating lists and filing into them is on the website for now."

That sentence shipped in [the readlists announcement](/blog/sort-your-saves-into-readlists?utm_source=blog-one-share-every-readlist-it-belongs-in&utm_medium=internal&utm_content=post-sort-your-saves-into-readlists), dated 1 day before this post. The filing half of it is already out of date.

The iPhone app now opens on a readlist instead of the undivided pile, and the share sheet files one shared link into several lists at once.

## A menu where the rail would be

The website wears readlists as a rail of tabs. The app shows 1 list at a time: its name sits under the title, and a menu beside it switches to any of the others. Whichever list is on screen when the app closes is the one it opens on next launch.

The To Read and Read tabs keep their counts inside whichever list is showing, and marking an article read there still flips it in every list that holds it. Read stays a fact about the article.

## The share sheet asks once

The first share after this update grows a question inside the card the sheet already draws: which readlists should shared articles drop into? Tick 1 list or several, or press Done with nothing ticked, and shares keep landing in All alone, the way they did last week. Each of those is an answer, and the question doesn't come back.

Changing the answer doesn't mean finding a settings screen. Each list carries a checkbox above its articles that reads "Shared articles drop here" when the list takes shares, and asks whether it should when it doesn't. It sits on the To Read side only, because a shared article doesn't arrive already read. The menu badges the ticked lists.

All has no checkbox. Every save lands in All regardless, so a tick there could only repeat what happens anyway.

## One request, all destinations

A link shared with 'Work' and 'Recipes' ticked lands in both, and in All, through a single save. The confirmation does the bookkeeping: "Saved to 'Work' and 'Recipes'", with 3 or more names reading as a list. The card holds for 3 seconds so that line can be read, and a tap outside still closes it sooner.

> **Where a share lands is a decision made once, not a question every save repeats.**

The confirmation's words come from the server, and the browser extension reads the same ones, so 2 surfaces don't describe 1 save differently.

Sharing a link a list already holds moves it back to the top of that list instead of doing nothing, which is usually what the second share was for.

## Still on the website

Renaming a list, deleting one, and the rail itself stay on the saved-links page. The app reads lists and files into them, and the housekeeping hasn't made the trip.

Both share answers belong to the account rather than the phone. Signing out clears them, so the next account on the device is asked for its own, and a session that expires on its own keeps them for when you sign back in.

## After the first Done

The question is already waiting in the share sheet of [the iPhone app](/blog/readplace-iphone-app-on-the-app-store?utm_source=blog-one-share-every-readlist-it-belongs-in&utm_medium=internal&utm_content=post-readplace-iphone-app-on-the-app-store). Tick the lists that keep coming up, press Done, and the links you share after that file themselves. If there is nothing to tick yet, a first list is 1 typed name away at [readplace.com](/?utm_source=blog-one-share-every-readlist-it-belongs-in&utm_medium=internal&utm_content=home).
