---
title: "Saved articles become Markdown notes in your Obsidian vault"
description: "The Readplace plugin is in Obsidian's community directory. It syncs every saved article into your vault as a Markdown note with the article's text and its AI summary, checks for changes every 60 minutes, and leaves any note you've edited exactly as you left it."
excerpt: "A vault is plain files on the owner's disk. A plugin that writes into it signs the same deal."
tldr: "Obsidian's community plugin directory now lists Readplace. The plugin copies every saved article into the vault as a Markdown note holding the article's text and its AI summary, checks for changes every 60 minutes while Obsidian is open, and updates a note only while it's unedited. An edited note stays as its owner left it, a removed article leaves its note behind, sync runs one way into desktop Obsidian, and an account that stops paying can still sync the articles it saved."
slug: "sync-saved-articles-into-obsidian"
date: "2026-11-12"
author: "Fayner Brack"
keywords: "obsidian read it later plugin, sync saved articles into obsidian, save articles as markdown notes, obsidian article sync, read it later app with obsidian export, readplace obsidian plugin, obsidian community plugin, readplace"
---

Inside an Obsidian vault, a note is a plain Markdown file on the owner's disk. Any editor opens it, any script can read it, and the folder stays readable if Obsidian itself goes away. Obsidian's maker wrote the principle down as [file over app](/view/stephango.com/file-over-app): the files are the point, the app is passing through.

A plugin that writes into that folder takes on the same obligation.

The Readplace plugin for Obsidian is now in the [community plugin directory](/view/community.obsidian.md/plugins/readplace). It copies the articles saved in a Readplace account into the vault as Markdown notes, each holding the article's text and its AI summary. Because it writes into a folder it doesn't own, the rule it follows is blunt: it doesn't replace a file it didn't create, and a note stops receiving updates the moment it's edited.

> **A plugin that writes into a vault is judged by the files it leaves alone.**

## One note per saved article

Sync now, in the plugin's settings, walks through every saved article in the account, across all readlists, and writes 1 note per article into a Readplace folder in the vault. New notes can go to a different folder instead, picked in the settings. While Obsidian stays open, the plugin checks for changes every 60 minutes on its own.

A note carries the article's text as Markdown and, once it's ready, the AI summary. An article saved a minute ago can arrive thin, because the crawl behind it is still running, and the text fills in on a later pass.

The plugin is free and runs on desktop Obsidian, on macOS, Windows and Linux. The mobile apps are outside this release. A Readplace account is the one thing it needs to read from.

## The edit that ends the updates

Until a note is touched, the plugin keeps it current. A recrawl's newer text, a summary that finished and a change in reading status each land on the next pass.

Editing the note changes its standing. Before updating a file, the plugin checks whether the file still matches what it wrote, and a file that differs is left exactly as it is. The paragraph of commentary you add under a quote stays put, and so does a sentence you deleted, no matter what the article does afterwards.

What about a note edited before its summary finished? The summary isn't lost, it waits in the Readplace reader. The note keeps the shape its owner gave it.

## Removing things doesn't reach the vault

Removing an article from Readplace leaves its note in the vault. Deleting a synced note in Obsidian holds too: the next pass doesn't recreate it. A note moved while the plugin was off counts as removed as well, and stops receiving updates. Signing the plugin out leaves every note where it sits.

The subscription follows the same line. An account that stops paying keeps its saved articles readable, and the plugin still syncs them into the vault. The notes were plain files from the first pass, so there's no export to run on the way out.

## Where the sync stops

Sync runs one way, from Readplace into Obsidian. An edit in the vault doesn't travel back, and neither do [highlights made in the reader](/blog/highlights-and-notes-stay-on-their-passage?utm_source=blog-sync-saved-articles-into-obsidian&utm_medium=internal&utm_content=post-highlights-and-notes-stay-on-their-passage), which stay in Readplace. Highlight export into a vault is the row where [Readwise Reader is still ahead](/blog/readplace-vs-readwise-reader?utm_source=blog-sync-saved-articles-into-obsidian&utm_medium=internal&utm_content=post-readplace-vs-readwise-reader).

TBH, the sync is also all or nothing: every saved article comes across, and a single readlist can't be chosen on its own yet.

The Markdown carries no tags and no author, and a published date only when one is known. Images stay links to their original hosts, so a vault read offline shows the text without the pictures.

## From Community plugins to the first pass

Install Readplace from Community plugins in Obsidian's settings and turn it on. Under Settings → Readplace, Sign in or Create account opens the browser to approve the connection, and Return to Obsidian closes the loop. Sync now does the rest.

The connection grants the same account access as the other Readplace apps, even though the plugin only reads. It shows under Connected apps in the Readplace account, and revoking it there cuts the plugin off without touching a single note.

[The landing page](/obsidian-read-it-later?utm_source=blog-sync-saved-articles-into-obsidian&utm_medium=internal&utm_content=obsidian-landing) holds the pitch as 1 screenshot: an article synced from Readplace, open as a note beside the owner's own. A vault on a desktop and [a readlist](/queue?utm_source=blog-sync-saved-articles-into-obsidian&utm_medium=internal&utm_content=readlist) with something worth keeping are all that Sync now asks for.
