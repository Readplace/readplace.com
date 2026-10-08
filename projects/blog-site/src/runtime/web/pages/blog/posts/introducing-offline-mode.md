---
title: "Introducing Offline Mode: Read Saved Articles Without Internet"
description: "Introducing Offline Mode for Readplace on the web and iPhone. Saved articles, their images and the reading list open with no internet connection, and one button downloads every unread article before a flight, a train or a tunnel, without marking any of them as read."
slug: "introducing-offline-mode"
date: "2026-10-09"
author: "Fayner Brack"
keywords: "offline mode, read articles offline, offline reading app, read it later offline, download articles for offline reading, read saved articles without internet, offline reading list, pocket alternative offline, airplane mode reading, iphone offline reading app, readplace"
tags: ["changelog"]
banner: "Introducing Offline Mode: saved articles open with no signal"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

A flight, a train tunnel or hotel Wi-Fi that wants a room number no longer stands between a saved article and its reader. Readplace now has Offline Mode on the web and on iPhone: an article opened once stays readable on that device, images and reading list included, and "Download unread for offline" stores the whole To Read tab in one press. Downloaded articles carry a "Saved offline" tag, downloading marks none of them as read, and the stored copies belong to the account that saved them.

</div>
</details>

At 35,000 feet, a saved article used to be a network error. The same error waited underground between 2 stations and on hotel Wi-Fi that drops every few minutes, which are the exact places a reading list gets saved up for.

Offline Mode fixes that on the web and in the iPhone app. It rests on 4 parts: a **fallback** that opens what the device already holds, a **download** that fills the device on purpose, a **freshness** rule that keeps an old copy from passing as current, and an **owner** rule that keeps one account's library away from the next person at the keyboard.

## Read saved articles offline, with no setup

The **fallback** asks nothing of the reader. Opening a saved article keeps a copy on the device that opened it, images included, and the reading list page gets the same treatment. When the connection fails, Readplace opens that copy instead of an error, under a banner that reads "Your internet is not working, your reading is offline." Once a request reaches the server again, the banner gives way to a "Back online" notice.

The iPhone app does the same from its own store. A cold launch in airplane mode opens on the reading list the app last showed, and lazy-loaded images appear from the stored copy. A stalled connection gets 10 seconds before the app switches to the copy, so a weak signal on a platform doesn't leave the screen spinning.

## Download unread articles for offline reading

The **download** is for the trip you can see coming. The To Read tab carries a "Download unread for offline" button. Pressing it shows a progress bar at once, counted from the tab's total, and Readplace fetches 6 articles at a time on the web and 4 at a time on the iPhone while it is still walking the list. Each article lands with its images.

The run ends on a count such as "12 available offline", and every card that made it carries a "Saved offline" tag with a green check. A run cut short by a closed laptop lid or a lost signal picks up where it stopped: the next visit offers to continue, and Readplace skips the articles it already holds at their current version.

Readplace also tells a download apart from a visit. The To Read tab still says what is unread when the download finishes, which is the list a long flight needs.

> **Downloading the whole To Read tab marks none of it as read. Reading an article is still what marks it read.**

## Offline copies stay fresh and private

**Freshness** works in 2 directions. Readplace opens no stored copy older than 30 days, so offline reading shows a recent page rather than a stale snapshot. And when an article changes online after the device stored it, the "Saved offline" tag drops off its card, and the reader shows a bar with a Refresh button the next time the article opens with a connection.

The **owner** rule covers shared machines. Each stored copy belongs to the signed-in session that saved it, and Readplace serves it to that session alone. Signing out clears the copies on the web and in the iPhone app. On the web a new sign-in clears them too, so a second account on a family laptop starts with an empty device instead of someone else's library.

## Before the cabin door closes

Offline Mode answers 1 question before a trip: is the reading on the device? Press Download unread for offline at the gate, watch the count climb, and the number on the screen is the answer.

The list it downloads is the one [the browser extension](https://readplace.com/install) and [the iPhone app](/blog/readplace-iphone-app-on-the-app-store?utm_source=blog-introducing-offline-mode&utm_medium=internal&utm_content=post-readplace-iphone-app-on-the-app-store) have been filling all along, and a long read meant for an e-reader still has [the EPUB download](/blog/read-your-saved-articles-on-a-kindle-or-kobo?utm_source=blog-introducing-offline-mode&utm_medium=internal&utm_content=post-read-your-saved-articles-on-a-kindle-or-kobo). Open [your readlist](/queue?utm_source=blog-introducing-offline-mode&utm_medium=internal&utm_content=readlist) while the signal still holds.
