---
title: "Save All Tabs, Then Close the Window"
description: "One right-click sends every open tab in the window to your Readplace queue, from the page, the toolbar icon, or in Firefox the tab strip. The save keeps running after the popup closes and an OS notification reports the outcome, so the window can close the moment the save starts. 100 tabs hand off in about a second."
slug: "save-all-tabs-then-close-the-window"
date: "2026-08-03"
author: "Fayner Brack"
keywords: "save all tabs, save all open tabs to read later, close all tabs without losing them, onetab alternative, bulk save tabs chrome extension, save tabs firefox extension, too many browser tabs, save whole window to reading list, save tabs before closing browser, pocket alternative save all tabs"
tags: ["changelog"]
banner: "I made one right-click save every open tab"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

30 open tabs used to mean 30 separate saves, so the window stayed open for weeks as its own to-do list. One right-click now sends the whole window to your Readplace queue. Save All Tabs sits on the page menu, on the toolbar icon, and in Firefox on the tab strip and the Tools menu, and the extension's popup can start it too. The tabs with nothing to read in them, settings screens, blank tabs, local files, Readplace's own pages, are skipped and counted, so the summary reads Saved 27 · Skipped 4 instead of pretending they were articles. The save keeps running after the popup closes: every tab's place in the queue is claimed before any upload begins, and an OS notification reports the outcome once it's done, so the window can close the moment the save starts. A tab closed early only loses its captured copy of the page, and the crawler fetches that article from the source instead. 100 tabs hand off in about a second, measured on CI's 2-core machines. The old Ctrl+Shift+D chord is gone, the menus are the only trigger now, and the update asks for one new permission, notifications, which is what carries the report.

</div>
</details>

"Right click on a page, right click on the extension, right click on the tab." A paying reader sent that list, and a reason with it: no browser has settled where a bulk save should live, so it should sit in all of those places at once.

Save All Tabs now does. It's the menu item that sends every open tab in the window to your Readplace queue, and it sits on each surface a browser lets an extension reach.

The larger change is behind it. The save no longer needs the window it started from. Click it, close the browser, and the outcome still finds you.

## One right-click, the whole window

Right-click the page you're reading, or the Readplace icon next to the address bar, and Save All Tabs is there. Firefox adds 2 more spots, the tab strip and the Tools menu. The popup carries a button for it too, so the surface that used to only show the result can start the work.

Not every tab is an article, and the save doesn't pretend otherwise. A settings page, a blank new tab, a local file: nothing there can land in a reading queue, so they're skipped on the spot, along with Readplace's own pages. Open the same address in 2 tabs and they collapse into 1 save, because a second save of an article lands on the row the first one made.

The summary owns up to the difference. It reads Saved 27 · Skipped 4, and a Failed count appears only when something failed.

A page too large to capture in full still gets in as a link, and the report names it with its size rather than letting it turn into a mystery later.

## A report that outlives the popup

A browser destroys an extension's popup the instant it loses focus. Click anywhere else on the screen and the little window is gone, along with whatever it was about to say.

The bulk save already survived that. The work runs in the background, so losing the popup cost no saves. It cost the report. There was no summary and no badge, just the queue to open and count.

An OS notification is the one channel that outlives the window it was started from, so the outcome now arrives as one. Its text comes from the same code that paints the popup's summary, which keeps the 2 surfaces from disagreeing about 1 save. The failure you can act on is named as itself: signed out, the notification says "Sign in to Readplace to save your tabs" instead of dressing a missing session up as an error.

Closing things early is safe because of the order the work runs in. The URLs are collected out of the tabs before any upload starts, so each tab's place in the queue is claimed while the window is still open, and the heavy part comes after. A tab that vanishes mid-save loses only its captured copy of the page. The link still saves, and the crawler fetches the article from the source instead.

> **The tabs are yours to close the moment the save starts, not the moment it finishes.**

## 100 tabs in about a second

A perf suite drives the real trigger against 100 open tabs, the same code path your click takes. On GitHub's 2-core runners the whole handoff, from enumerating the window to the last chunked upload, averages 888 ms in Chrome and 705 ms in Firefox over 20 independent runs. The slowest single run came in under 1.2 seconds. A developer machine does the same work in about 130 ms.

What lands inside that second is the handoff. The clean reading copy of each article renders behind it, the way it does when you save 1 link.

## Two menus Chrome doesn't have, and a chord that's gone

Chrome offers extensions no menu on the tab strip, so right-clicking a tab shows Save All Tabs in Firefox and nothing in Chrome. That asymmetry belongs to [Chrome's menu API](/view/developer.chrome.com/docs/extensions/reference/api/contextMenus), not to a choice I made. The Tools-menu entry is Firefox-only for the same reason: [Firefox's menus API](/view/developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus) names that surface and Chrome's has no word for it.

The keyboard chord went the other way. Ctrl+Shift+D, Cmd+Shift+D on a Mac, used to fire the bulk save, and it's gone from both extensions. The menus are the single trigger now, and a menu item that says what it does beats 3 keys that could mean anything. If you had rebound the chord, Chrome drops the binding when the update lands and the menu carries on.

One prompt meets you at the update. The report rides a notifications permission the extensions didn't hold before, so Chrome turns the extension off until you approve it, and Firefox holds the update back until you do. TBH that's real friction for one dialog's worth of text, and it's still worth it: the permission is the only channel that survives the popup.

## The window you can finally close

A window full of tabs is a reading list kept in the most expensive place a computer has. It costs memory to hold and 30 decisions to close, and it says nothing about which tab deserves the evening. The queue those tabs land in does: each saved article opens with its reading time and a TL;DR, because [I built Readplace](/blog/why-i-built-readplace) for deciding what not to read, not for saving more.

Put the extension on [Chrome or Firefox](/install), find the window you've kept alive for weeks, and right-click it into the queue. When the notification lands, the tabs are at [readplace.com](/) and the window is just a window again.
