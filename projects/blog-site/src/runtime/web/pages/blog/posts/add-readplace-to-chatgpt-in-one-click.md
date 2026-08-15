---
title: "Add Readplace to ChatGPT in One Click"
description: "ChatGPT used to reach your reading queue through Developer Mode and a custom connector you assembled by hand. Readplace is now an official ChatGPT plugin, so the connection is an Add button and one sign-in, and then ChatGPT saves links straight to your queue and reads your list back mid-chat."
slug: "add-readplace-to-chatgpt-in-one-click"
date: "2026-08-15"
author: "Fayner Brack"
keywords: "add readplace to chatgpt, chatgpt readplace plugin, official chatgpt plugin read it later, save articles from chatgpt, chatgpt save to reading list, connect chatgpt to reading queue, chatgpt mcp connector, read it later ai assistant, chatgpt developer mode custom connector, pocket alternative chatgpt"
tags: ["changelog"]
banner: "I made connecting ChatGPT to your queue a one-click thing"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

ChatGPT now carries an official Readplace plugin. Connecting them used to mean turning on Developer Mode in ChatGPT's settings, adding a custom connector, pasting a server URL, and picking an authentication method before the sign-in even appeared. Now it is an Add button and a one-time sign-in. Once connected, ChatGPT saves links straight to your reading queue and reads your list back, mid-chat, through the same MCP server Claude and Gemini already use. It still cannot delete anything from your account, and the hand-built connector route stays available for anyone who prefers it.

</div>
</details>

Settings, then Apps & Connectors, then Advanced, then a toggle called Developer Mode. Connecting ChatGPT to a Readplace queue started 3 menus deep, behind a switch built for people testing software they are writing themselves. Past the toggle sat a custom connector form asking for a server URL and an authentication method, and only after all of it came the sign-in that mattered.

That panel is now a button. ChatGPT accepted Readplace into its plugin directory, so the connection is an official listing: open it, choose Add, sign in to Readplace once. [The install page](/install?client=chatgpt) carries the same button under the label Add Readplace to ChatGPT.

> **A connection you have to assemble reaches the people who build connectors. A button reaches readers.**

## An Add button instead of a walkthrough

The old instructions existed because they had to. ChatGPT could only reach an outside tool through a custom connector, and custom connectors live behind Developer Mode, a switch aimed at developers testing their own work. The walkthrough on [readplace.com/mcp](/mcp) covered every stop, and it was accurate. It also filtered out nearly every reader who was not at home in a developer settings screen.

The official listing removes the assembly instead of describing it better. The plugin carries the server details, so there is nothing to paste and no mode to switch on. Press Add, approve the sign-in Readplace shows you, and the connection is live. It is the same OAuth approval [every assistant connection here uses](/blog/connect-ai-assistant-without-an-api-key): no API key to copy, and access you can revoke from your account whenever you want.

## What a connected ChatGPT does

Underneath, the plugin speaks to the same MCP server that Claude and the Gemini CLI use. The tools did not change, and that is the point. The capability was already there. The setup was what stood in front of it.

Ask ChatGPT to save an article it recommended, and [the link lands in your queue](/blog/save-articles-with-your-ai-assistant) with the title, the clean copy, and the TL;DR filling in as the crawler works. Ask what is waiting in your queue, and it reads the list back. Mid-research, "copy the link, switch apps, paste it somewhere" becomes one sentence addressed to the assistant that found the article in the first place.

The boundaries came along unchanged. ChatGPT cannot delete anything from your account, because that one tool answers without acting and points you back to the app. And a link saved from a chat starts as a placeholder card that fills in as the crawl finishes, the same as a save from the browser extension.

## Where the old path still lives

The hand-built route still works. The server URL sits on the install page beside the button, so a reader who would rather wire the connector personally, or who uses a client with no plugin directory, pastes it exactly as before. Claude and Gemini connect that way today. The listing is one directory entry for one client, and the other assistants keep their guides.

TBH the button also retires a maintenance problem the walkthrough could not shake: I wrote those menu steps by hand, and each time ChatGPT rearranged its settings the steps drifted a little further from the screen in front of you. A listing ChatGPT hosts itself cannot drift that way.

## Asking for the first save

Add the plugin from [the install page](/install?client=chatgpt), hand ChatGPT a link in any chat, and ask it to save the article for later. The card is waiting in [your queue](/) when you come back for it, TL;DR on top. On Claude or Gemini instead, [the connection guide](/mcp) gets you to the same place with the same one-time sign-in.
