---
title: "Readplace opens on the saves you picked by hand"
description: "Signed in, readplace.com used to open on All, which keeps every import and newsletter link beside the saves. It now opens on Hand Picked, the readlist that holds only what a tap saved on purpose, and the iPhone and Android apps can set any readlist as Home. The web, the sign-in return and the extension popup follow the choice."
excerpt: "Sign-in used to land on every link that ever arrived. Now it lands on the saves made on purpose."
tldr: "The first screen after sign-in is now Hand Picked, the readlist that holds only what a tap saved on purpose. Readplace used to open on All, which keeps every save, import and newsletter link. Any readlist can take over as Home: pick one in the iPhone or Android app, and the web front page, the sign-in return and the extension popup all open it. Imports and newsletter links keep landing in All only, and an older save moves into Hand Picked only when it's chosen."
slug: "readplace-opens-on-the-saves-you-picked-by-hand"
date: "2026-11-27"
author: "Fayner Brack"
keywords: "choose home readlist, hand picked reading list, read it later start screen, reading list opens on your saves, declutter read it later, pocket alternative, readplace hand picked, home readlist"
---

All keeps every save, and it used to greet every sign-in too. A bookmarks import lands there, and so do [the links a newsletter issue carries in](/blog/clear-out-the-newsletter-links-you-never-opened?utm_source=blog-readplace-opens-on-the-saves-you-picked-by-hand&utm_medium=internal&utm_content=post-clear-out-the-newsletter-links-you-never-opened). That's a promise worth keeping, and a poor first thing to put on screen.

Signed in, readplace.com now opens on Hand Picked instead, a readlist that fills itself with the saves a tap made on purpose and with nothing that arrived on its own. The opening screen stopped being fixed at the same time. Home is a setting now, and any readlist can hold it.

> **What greets a sign-in is now the shortlist, not the archive.**

## What Hand Picked holds

A save that was somebody's decision lands in Hand Picked the moment it lands in All. That covers the page sent from the Chrome or Firefox extension, Save all tabs included, the share from the iPhone and Android apps, a link pasted on the web, and a save sent over [the API](/blog/build-on-the-readplace-api?utm_source=blog-readplace-opens-on-the-saves-you-picked-by-hand&utm_medium=internal&utm_content=post-build-on-the-readplace-api).

What arrived on its own stays out. An import saves its links so the article behind each one is ready when it's wanted, and a newsletter issue does the same, and neither was chosen one row at a time. Both keep landing in All only.

The caption under each list says which is which. All reads "Every save is here, including newsletter links and imports", and Hand Picked reads "Everything you save yourself is added here".

In the card's move dialog, Hand Picked is one more readlist. An article moves there from any list, the toast reads "Moved to Hand Picked", and its Undo puts the article back where it came from.

## Older saves wait to be asked

Nothing was moved in.

A script sat ready to backfill older saves into Hand Picked before the release, and it was deleted unrun, because a backfilled row is the one kind this list can't carry: nobody picked it. The empty state says the same thing in product words, "Articles you save from now on appear here. Older saves stay in All."

An older article gets in through the usual Add to readlist dialog, which offers Hand Picked wherever the article isn't in it yet. For more than a few, the Add older saves from All button on Hand Picked starts the browsing where those articles are.

## Home is a setting

Hand Picked is the default, and a default is as far as it goes. In the iPhone or Android app, each readlist carries Set as home readlist, so Home can be All again for anyone who wants the archive back, a project's list, or [a Smart Readlist](/blog/tell-a-readlist-what-to-collect?utm_source=blog-readplace-opens-on-the-saves-you-picked-by-hand&utm_medium=internal&utm_content=post-tell-a-readlist-what-to-collect) that files its own arrivals.

The account carries the choice, and the surfaces follow it. The signed-in front page, the return after signing in and the Readlist item in the web navigation open the Home list, the readlist rail marks it with a Home badge, and the extension popup opens it and names it over the rows. A Home list that gets deleted stops being Home, and sign-in falls back to Hand Picked.

A client of [the API](/developers?utm_source=blog-readplace-opens-on-the-saves-you-picked-by-hand&utm_medium=internal&utm_content=developers) follows along by sending one header, X-Readplace-Home-Readlist: 1, which points the browse list's home link at the chosen readlist. The developers page documents it.

## Where sign-in lands now

A reading list where most rows arrived by email or import doesn't read like a plan for an evening. The first screen was the worst place for it.

The rows behind [the next sign-in](/queue?scope=home&utm_source=blog-readplace-opens-on-the-saves-you-picked-by-hand&utm_medium=internal&utm_content=readlist) are the chosen ones now, on the web, in the popup and in the apps. A first link pasted at [readplace.com](/?utm_source=blog-readplace-opens-on-the-saves-you-picked-by-hand&utm_medium=internal&utm_content=home) opens the shortlist, and every sign-in after that opens on it.
