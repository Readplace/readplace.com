---
title: "Sync across your devices comes with the plan"
description: "Saves, highlights, readlists and read status follow you from the laptop to the phone to your AI assistant, with no sync add-on, no device limit and no second bill."
tldr: "Sync is the part of a note app that tends to cost extra, either as an add-on or as the reason to upgrade. Readplace has no sync product because the phone, the laptop, the browser extension and the AI assistant all read the same account on the same server. The one exception is Offline Mode: a device without a connection reads its own copy and stays read-only until it is back online."
excerpt: "Sync is the part of a note app that tends to cost extra. Readplace has nothing to sell there."
slug: "sync-across-your-devices-comes-with-the-plan"
date: "2026-11-08"
author: "Fayner Brack"
keywords: "free sync read it later, sync articles across devices, read it later app sync, obsidian sync alternative, no device limit, read later iphone and laptop, cross device reading list, evernote device limit, bear pro sync, readplace"
---

## Where the second bill comes from

Sync is the line item note-taking apps tend to sell on its own.

Obsidian lists it under "optional add-on services" on [its pricing page](/view/obsidian.md/pricing), next to a core app that is free. Bear puts "iCloud sync for all your notes" inside [Bear Pro](/view/bear.app/faq/features-and-price-of-bear-pro/). Evernote moved its Free plan to [1 device at a time in August 2024](/view/evernote.com/blog/free-limit-changes-august-2024), and the web app counts as that device.

None of this is hidden, and each of those apps does a lot more than store links. The business reason is easy to follow too. A note app can keep its files on your disk, and getting the same files onto a second machine is real work somebody has to run. So that work becomes the thing you pay for.

The cost shows up as a habit before it shows up as money. You start remembering which device holds what. The article you saved on the laptop lives on the laptop, and the phone in the queue at the café has a different list.

> **The habit of checking which device has your reading is the real price of paid sync.**

## Readplace has no sync step to charge for

Readplace keeps your saves in one place: your account, on the server. Each client is a window onto that account.

The web app renders the page on the server and sends HTML. The Chrome and Firefox extensions ask the same routes for Siren, a hypermedia format the server answers with when the client asks for `application/vnd.siren+json`. The iPhone app reads Siren from the same server. Claude, ChatGPT and Gemini connect through MCP and read the same saves.

Nothing gets copied from one device to another, because no device holds its own version of the list. When you save an article from the extension, the server writes it once. The phone sees it the next time its reading list loads.

What follows you between devices:

- **Saves** from any client, including links an AI assistant saved for you.
- **Read and unread**, so finishing an article on the laptop takes it off the phone's unread list.
- **Highlights** you made while reading.
- **Readlists**, with the links filed into them.
- **Past reads**, the record of what you already finished.

There is no device count and no session cap on the account. Signing in on a work laptop does not sign the iPhone out.

Sync comes with every plan, because there is no separate piece of it to price. Readplace itself is a paid app, and [the current plans](/?utm_source=blog-sync-across-your-devices-comes-with-the-plan&utm_medium=internal&utm_content=pricing#pricing) say what it costs.

## What "the same account" means in practice

A screen that is already open does not repaint by itself. The change shows up on its next page load, or when you go back to the list. That is a plain request to the server, so it tends to take as long as any other page.

This is also why renaming a route on the server does not break the extension. The extension only knows the entry point and the action names the server publishes, such as `save-article`. Each step after that comes from the server's answer. A client that discovers its next step from the response has no copy of the app to fall out of date, and that same property is what keeps your list consistent across devices.

## The honest caveat: offline

TBH, there is one case where the devices do disagree, and it is on purpose.

[Offline Mode](/blog/introducing-offline-mode?utm_source=blog-sync-across-your-devices-comes-with-the-plan&utm_medium=internal&utm_content=offline-mode) keeps a copy of your unread articles on the device, so a flight or a dead zone still has something to read. On the web, a service worker keeps that copy for the reading list. On the iPhone, the app stores it on disk.

While a device has no connection, it reads that copy and nothing else. The app says so in plain words: "Your internet is not working, your reading is offline. Readplace is read-only until you're back online."

Read-only means read-only. Marking an article as read, saving a new link and adding a highlight are unavailable until the connection comes back. Nothing done offline is stored up and sent later. That keeps one copy of your account on the server instead of two copies that need merging.

The downloads themselves stay on the device that made them. Turning on Offline Mode on the phone does not fill the laptop's disk.

## A read-it-later app is not a note app

The contrast above is with note-taking apps, and it would be unfair to stretch it further. Instapaper's free tier also syncs across web, iOS and Android, per [its premium page](/view/www.instapaper.com/premium). A read-it-later app tends to keep your list on its server anyway, so sync is part of the base product there.

The comparison that holds is narrower. If your reading list lives in Obsidian, Bear or Evernote today, the second device is what costs extra. In Readplace, the second device is another sign-in.

## Two devices and one article

Save an article from the browser extension on the laptop and highlight a paragraph. Open the iPhone app. The article is at the top of the list.

Read it on the train and mark it read when you reach the end. Back at the desk, the laptop's unread list no longer has it, and the highlight is there when you open the article from your past reads.

The test takes a few minutes, and [readplace.com](/?utm_source=blog-sync-across-your-devices-comes-with-the-plan&utm_medium=internal&utm_content=home) is the place to run it with your own reading.
