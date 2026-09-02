---
title: "Start a Readlist Without Leaving the Article"
description: "The only control that files an article into a readlist stayed hidden from any reader who owned no readlists yet, so first-time filing began with a trip away from the article. The reader's menu now ends in a name field and a plus button: type up to 24 characters and Readplace creates the list with the open article already filed in it. A name already in use files into that list instead of failing."
slug: "start-a-readlist-without-leaving-the-article"
date: "2026-09-02"
author: "Fayner Brack"
keywords: "create a reading list, organize saved articles, reading list folders, sort articles into lists, read it later organization, file articles while reading, readlist, pocket alternative folders, readplace"
tags: ["changelog"]
banner: "Starting a readlist no longer means leaving the article"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

The reader's Add to readlist menu now ends in a name field and a plus button, so a first readlist can start inside the article it's for. Readplace creates the list and files the article in 1 submit, and a name that's already taken files into that list instead of duplicating it. An account holds up to 7 readlists with names up to 24 characters. The rail caught up the same day: each list you made carries its own delete control and confirmation, and deleting one keeps you where you were instead of dumping the view back on All.

</div>
</details>

Every article that lands in a readlist gets there through one control, a disclosure in the reader toolbar labelled Add to readlist.

Until this week that control rendered only for a reader who already owned a readlist.

The readers it hid from were the ones it existed to recruit. An account with no readlists got a toolbar with no filing control, so readlists were a thing a reader learned about somewhere else, or not at all.

Finding out meant leaving the article. Creation lived on the readlist rail, the new list arrived wearing a default name, a separate rename gave it a real one, and the article that prompted the whole trip waited a page behind.

> **The one place filing happens carried no sign that filing existed.**

## A name field where the list starts

The Add to readlist menu now opens for a reader who owns no readlists at all. Its last row is a text field and a plus button.

Type a name and press the plus. The readlist exists, and the article being read is already in it.

The whole thing is 1 submit.

There's no separate create step and no rename afterwards, because the name field is the create step and the open article is the first entry.

The row is also a plain form. A browser with JavaScript turned off posts it and comes back to the article, and a create the server refuses redirects to the reader instead of stranding anyone on an error page.

## A taken name files instead of failing

Type a name that already belongs to one of your readlists, in any casing, and the article files into that readlist. No duplicate appears and nothing complains, because there's nothing to complain about: the list was named, and the name resolved.

That behaviour removed the one failure this row could reach. The reader has no toast and no error banner, so a name clash had nowhere honest to be reported, and instead of relocating the message the design deletes the situation. The readlists sit listed directly above the field, so typing one of their names now does what clicking its row does.

One name stays off limits. All is where every save already lands, so it isn't a name a new readlist can take.

## The edges

An account holds up to 7 readlists, and a name runs to 24 characters. At the cap the create row leaves the menu while the existing rows keep filing.

The menu isn't what enforces the cap. A create that races past a stale menu is refused on the write itself, and the refusal comes back as the same redirect to the reader, so the worst case of the race is an unchanged page rather than a broken one.

## The rail caught up

The rail where readlists live got the other half of this week's work.

Every list you made now carries its own delete control and its own confirmation, so removing one doesn't mean opening it first. Deleting also stopped throwing the view back to All: unless the list on screen is the one being removed, the screen stays put.

Renaming took the smaller fixes. The pencil moved to the tab's far edge instead of crowding the name, and the ring that marks a rename in progress is drawn closed around the tab instead of clipped behind the panels beside it.

## The first readlist, made mid-article

A readlist is worth starting at the moment an article makes the pattern visible, and that moment arrives mid-read.

The menu now agrees.

Save the next article that reads like the start of a pile, open it at [readplace.com](/), and look at the last row of Add to readlist. The name you type there is the whole setup.
