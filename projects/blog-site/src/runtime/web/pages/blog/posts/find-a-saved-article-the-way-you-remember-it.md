---
title: "Find a Saved Article the Way You Remember It"
description: "Memory keeps a saved article as fragments: part of a title, the site it came from, roughly how long it runs, roughly when it was saved. The readlist now takes those fragments as the question. A search field under the tabs matches titles, sites and addresses, a filter drawer narrows by reading time and saved date, and the narrowed list keeps its own URL and works without JavaScript."
excerpt: "A search field and a filter drawer now narrow the readlist from half a memory of an article."
tldr: "Scrolling is no longer the way to find a saved article. The readlist in Readplace now has a search field under its tabs and a filter drawer beside it: type any part of a title, a site's name or its address and press Enter, or tick chips for reading time and saved date, and the open tab narrows to what matches. The narrowed list keeps its own URL, survives paging and tab switches, works without JavaScript, and when nothing matches, 1 button clears exactly what was set."
slug: "find-a-saved-article-the-way-you-remember-it"
date: "2026-10-11"
author: "Fayner Brack"
keywords: "search saved articles, read it later search, find a saved article, search reading list, filter reading list by reading time, filter saves by date, pocket alternative with search, readlist search, readplace"
tags: ["changelog"]
banner: "Find a saved article from half a memory of it"
---

"About batteries, 10 or 15 minutes long, saved near the start of the month." That is how memory hands a saved article back, and the readlist used to take no part of it as input. Getting the article back meant scrolling until a card looked familiar.

The readlist now takes the description itself.

## Type the part you remember

Under the readlist tabs sits a search field, with a square filter button at its side. The field matches 3 things: the article's title, the name of the site it came from, and that site's address. Part of a word is enough, so "batter" finds the battery piece. Accents and capitals don't count, so "cafe" finds "café".

A query of 2 words keeps only the articles that hold both. Searching runs on Enter rather than on every keystroke, so the list holds still while the question is still being typed.

The search reads the tab that's open, so To Read answers with unread articles and Read with finished ones. A [readlist of your own](/blog/sort-your-saves-into-readlists?utm_source=blog-find-a-saved-article-the-way-you-remember-it&utm_medium=internal&utm_content=post-sort-your-saves-into-readlists) answers only from its own saves.

## A drawer for length and age

The filter button opens a drawer on the right edge with 2 groups of chips. Reading time holds "Under 5 min", "5–10 min", "10–20 min" and "20+ min". Saved date holds "Today", "This week", "This month" and "Older", and those count back from now: "This month" covers the last 30 days, and "Older" holds everything before that.

Ticks inside a group widen the answer, and ticks across groups narrow it. "10–20 min" together with "20+ min" asks for anything 10 minutes or longer, and adding "This month" keeps the recent part of that. While any chip is ticked, the filter button carries a dot, and a screen reader hears the count, so a narrowed list doesn't pass for the whole one.

> **Memory keeps a rough length and a rough date long after it drops the exact title, and those 2 are now the filters.**

## The narrowed list has an address

The search submits as a plain GET form, and the drawer redirects to the narrowed list's own URL, so the query and the ticked chips live in the page's URL. A narrowed list survives paging, a change of sort order and a switch between To Read and Read, and the back button retraces every step. A view worth repeating, such as "20+ min" inside To Read, can live on as a bookmark.

None of it needs JavaScript. The drawer is a native HTML popover, so the button opens it without a script. A browser too old for popovers gets a simple disclosure under the same button instead, and the same forms submit.

## An empty answer names what to clear

A query that matches nothing gets a page that says so: "No matching articles", a line naming the tab it looked in, and 1 button. The button says exactly what it will remove, "Clear search" after a search, "Clear filters" after chips, and "Clear search and filters" after both. An empty result stays visibly empty instead of widening into a looser match.

## The oldest saves make the best test

The chip with the most to show is "Older". It holds whatever went in more than 30 days ago, which is the part of a reading list that scrolling rarely reaches. Ticked together with "20+ min", it answers a question worth asking: which long reads have been waiting the longest.

The next article that goes missing is 3 remembered words away in [your readlist](/queue?utm_source=blog-find-a-saved-article-the-way-you-remember-it&utm_medium=internal&utm_content=readlist). A first save starts with a pasted link at [readplace.com](/?utm_source=blog-find-a-saved-article-the-way-you-remember-it&utm_medium=internal&utm_content=home).
