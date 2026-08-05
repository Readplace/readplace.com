---
title: "A Window Full of Tabs Is One Right-Click From Your Queue"
description: "Save All Tabs used to hide a hover deep in one menu. It now sits flat on the page menu, on the toolbar icon in Chrome and Firefox, on Firefox's tab strip and Tools menu, and in the popup, and it reports what it saved in a notification that survives closing the window a second after you click."
slug: "save-all-tabs-from-any-right-click"
date: "2026-08-05"
author: "Fayner Brack"
keywords: "save all open tabs, save all tabs to read later, close all tabs without losing them, too many tabs open, bulk save tabs chrome extension, save all tabs firefox, save tabs to reading list, tab hoarder reading queue, save browser session for later, pocket alternative save all tabs"
tags: ["changelog"]
banner: "I put Save All Tabs on every right-click menu your browser allows"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Save All Tabs takes the window you are in and saves every open tab to your reading queue, each with a captured copy of the page as you had it. It used to live in 2 spots, a hover deep inside the page's right-click submenu and on a keyboard shortcut. A paying reader asked for it on every surface a right-click can reach, and that is where it went. In Readplace's browser extension the item now sits flat on the page menu, on the toolbar icon in Chrome and Firefox, on Firefox's tab strip and Tools menu, and on a button in the popup. The outcome arrives as a system notification, Saved and Skipped counts with failures named when there are any, and it still arrives if you close the whole window a second after clicking, because each link is recorded before the first page upload starts. The keyboard shortcut is gone, the menus are the single way in.

</div>
</details>

> "everywhere i.e. right click on a page, right click on the extension, right click on the tab ... because there is no established behavior"

The request came from a paying reader, and it names the problem exactly: no browser has settled where a save-every-tab control belongs. So the ask was to stop picking one spot and be in each of them.

This week the extension did that.

Save All Tabs is the bulk save in the [browser extension](https://readplace.com/install). One click walks the window, saves each tab's link to your queue, and captures each page so the copy Readplace keeps is the one you had open. A window that took a month to pile up files itself in seconds.

## One hover too deep

Until now, right-clicking a page put Save All Tabs inside a submenu named Readplace. Your pointer stopped on the menu, and the item you wanted sat one hover further in.

That submenu was the browser's doing, not mine. Chrome and Firefox fold an extension's entries into a folder named after it as soon as 2 of them are visible in the same context, and the page menu carried 2: Save Page and Save All Tabs.

So the fix was subtraction. Save Page left the page menu, because the toolbar button and Ctrl/Cmd+D already save the page you are reading. One entry remains in that context, and a lone entry renders flat, no folder around it.

A control a hover deep is easy to stop noticing. Flat, it is just there.

## Wherever the right-click lands

The breadth came next. Save All Tabs now sits on the right-click of the Readplace toolbar icon, in Chrome and in Firefox. Firefox goes further: the item is on the tab strip and in the Tools menu too. And the popup, which could show a bulk save's result but not start one, gained its own Save all tabs button.

Chrome ends up with fewer entries than Firefox, and the gap is the platform's. Chrome's [context-menu API](/view/developer.chrome.com/docs/extensions/reference/api/contextMenus) offers extensions no tab-strip surface at all, while Firefox's [menus API](/view/developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/menus) names the tab bar and the Tools menu outright. Each browser carries the item on each surface it permits.

Which menus exist is not hardcoded either. The extension reads the actions the server offers and builds its menus from them, so a capability retired on the server folds its menu away with no new extension release.

One trigger went the other direction. The Ctrl/Cmd+Shift+D chord is gone from both extensions, and the right-click item is the single way to start a bulk save. Chrome drops the old binding on its own when the extension updates, so nothing is left half-wired.

## The report that outlives the window

The popup dies the moment it loses focus. The bulk save does not, and that was the problem: the work carried on in the background while the summary it owed you died with the window. You found out what happened by opening the queue and counting.

The result now arrives as a system notification, because a notification is the one channel that outlives the window it was started from. The title reads Tabs saved. The body carries the counts, Saved 12 · Skipped 4, and adds Failed only when something failed.

Those counts are the window's real totals. Tabs filtered out before saving, a browser settings screen, a Readplace page, a tab that duplicates its neighbour, land in Skipped instead of vanishing from the arithmetic, so the number you read matches the window you closed. A page too large to capture in full is saved as its link and named in the notice. A save refused because you are signed out says to sign in, the one failure that has a next step.

**The links leave the tabs before the first byte of page content uploads, so the window can close the moment the click lands.**

Closing early costs, at most, a page capture. The link is saved either way, and an article whose capture was lost still renders from the copy Readplace fetches itself, the same way [a single save already answers before its upload](/blog/save-a-link-and-close-the-tab).

## Empty a window into your queue

Count the tabs in the window you are reading this from. Each one is something you meant to get back to, held open because closing it felt like losing it.

Right-click the Readplace icon, or the page, or on Firefox the tab strip, and pick Save All Tabs to Readplace. Wait for the notification if you like, or don't. The links are already in [your queue](/), and the pages follow on their own.

The menu ships with [the browser extension](https://readplace.com/install), and what it saves lands at [readplace.com](/).

A window of open tabs is a reading list your browser is holding hostage. One right-click hands it back.
