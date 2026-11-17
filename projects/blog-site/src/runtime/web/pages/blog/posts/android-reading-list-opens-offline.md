---
title: "The reading list opens offline in the Android app"
description: "The Readplace Android app keeps a copy of the reading list on the phone, so a tunnel or a flight shows the saved list instead of an error. Writes keep the copy current, a copy expires after 30 days, and signing out deletes it."
excerpt: "A tunnel used to cost the Android app its whole list. Now the phone answers with its own copy."
tldr: "Losing signal no longer empties the reading list in the Android app. Readplace keeps each page of the list the app fetched as a copy on the phone, and when the network drops it shows the newest copy under an offline banner instead of an error. The app stays read-only until the connection returns, a copy older than 30 days is not shown, and signing out deletes the copies. The stored article copies and the Download unread button of Offline Mode are still on the web and the iPhone."
slug: "android-reading-list-opens-offline"
date: "2026-11-17"
author: "Fayner Brack"
keywords: "android offline reading list, read it later app android, read articles offline android, offline reading app android, android app reading list, pocket alternative android, readplace android, airplane mode reading list"
---

The Android launch post went out 6 days ago with a concession near the end: Offline Mode hadn't crossed over from the iPhone, so reading in the app needed a connection. Part of that sentence is now out of date. The reading list, the screen the app opens on, no longer needs one.

The change asks nothing of the reader. Each page of the list the app loads leaves a copy on the phone's own storage, and when a list read can't reach the network, the app opens the newest copy it holds.

## The copy the phone keeps

Every successful list read is also a write. The server's answer to the first page is kept under the tab it landed on, and each page scrolled into after it is kept under its own address, so the list comes back as deep as it was last read.

A cold start with no signal works the same way. The app launches into the readlist it last showed, and with the network gone it follows the stored answer to whichever tab that answer landed on. The kept page itself names its tab, so the app holds no extra preference for this.

## A banner instead of an error

The kept list appears under the sentence the iPhone app already shows: "Your internet is not working, your reading is offline. Readplace is read-only until you're back online."

Read-only is literal. Archiving, deleting and marking as read wait for the connection, and a row that was still being saved when the signal dropped stops asking the server about its progress. The first live page to arrive ends the offline state. The banner drops, and the rows that were mid-save start checking in again.

A phone that holds nothing yet gets a plainer screen: "You're offline. Your reading list will appear once you're back online."

## A copy has 30 days

The copy tracks what the account does. Deleting an article or marking it read makes the server answer with the list as the write left it, and that answer replaces the copy, so going offline afterwards doesn't bring a deleted row back.

Age has a harder rule, the same one the web and the iPhone app follow: a copy older than 30 days is deleted rather than shown.

> **A month-old list passed off as current is worse than an empty screen.**

## Signing out deletes the copies

The copies belong to the account that made them. Signing out deletes them, from either sign-out path, and a list read still in flight when the sign-out lands is refused rather than written back. A borrowed phone handed back, or a second account on the same device, starts from nothing.

## What hasn't crossed over yet

[Offline Mode](/blog/introducing-offline-mode?utm_source=blog-android-reading-list-opens-offline&utm_medium=internal&utm_content=post-introducing-offline-mode) is bigger than the list. On the web and the iPhone, an article opened once stays readable with no connection, and Download unread for offline stores the whole To Read tab before a flight. Neither has reached Android, so opening an article from the kept list still asks the network for the page.

The entry on [the launch post's missing list](/blog/readplace-android-app-on-google-play?utm_source=blog-android-reading-list-opens-offline&utm_medium=internal&utm_content=post-readplace-android-app-on-google-play) is crossed off partway, not fully.

## Where the signal drops

Readplace for Android is on [Google Play](https://play.google.com/store/apps/details?id=com.readplace.app). The copies start accumulating from the first signed-in look at the list, with nothing to switch on, so the next stretch of underground runs the check by itself.

Signing up happens at [readplace.com](/?utm_source=blog-android-reading-list-opens-offline&utm_medium=internal&utm_content=home), and the app takes it from there.
