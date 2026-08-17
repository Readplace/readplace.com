---
title: "Add Readplace to ChatGPT in One Click"
description: "Connecting ChatGPT to your reading queue used to mean a Developer Mode toggle and a hand-built custom connector. Readplace is now an official plugin in ChatGPT's directory: open the listing, press Add, sign in once, and ChatGPT can save links for you and read your queue back."
slug: "add-readplace-to-chatgpt-in-one-click"
date: "2026-08-17"
author: "Fayner Brack"
keywords: "readplace chatgpt plugin, official chatgpt plugin, connect chatgpt to reading list, chatgpt save articles, chatgpt read it later, chatgpt mcp connector, save links from chatgpt, chatgpt reading queue, add readplace to chatgpt, pocket alternative chatgpt"
tags: ["changelog"]
banner: "Readplace is now an official ChatGPT plugin, one click to add"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

ChatGPT's plugin directory now carries an official Readplace listing. The old route to the same connection ran 3 menus deep through a Developer Mode toggle and a hand-filled custom connector form. The new one is an Add button and a single sign-in. Underneath sits the same MCP server at readplace.com/mcp, with no API key to create and access you can revoke from your account. Once connected, ChatGPT saves links into your reading queue mid-chat and reads your saved articles back when you ask. The custom-connector route still works if you would rather paste the URL yourself, and nothing changes for Claude or Gemini.

</div>
</details>

Settings, then Apps & Connectors, then Advanced, then a toggle called Developer Mode. Connecting ChatGPT to Readplace used to start 3 menus deep, on a switch built for people testing software they wrote themselves.

Past the toggle sat a form. The server URL went in by hand, the authentication method came from a dropdown, and the sign-in landed last, 8 moves after the decision to connect the two.

The connection at the end of that walk was worth having. Once it is on, [ChatGPT saves a page into your reading queue mid-conversation](/blog/save-articles-with-your-ai-assistant) and [reads your saved articles back](/blog/ai-assistant-reads-your-saved-articles) when you ask what is in the pile. But a feature meets its audience at the setup screen before it meets them anywhere else, and this one's setup screen said: developers only.

> **A feature parked behind a developer toggle is a developer feature, whatever it does once it's on.**

That screen left the path. OpenAI approved Readplace as an official ChatGPT plugin, so it now has a listing in ChatGPT's directory.

The listing is a page with an Add button.

The whole setup is opening it, pressing Add, and approving one sign-in. The old route took 8 moves. This one takes 3, and one of the 3 is the sign-in.

## The toggle was doing the choosing

Developer Mode exists for people building connectors, so they can test a server before anyone else meets it. Reaching a finished product through it was a borrowed workflow. The path asked a reader to flip a switch labelled for someone else, inside a panel called Advanced, before the first article got saved.

Whoever finished it had done nothing developer-like at any point. The toggle was a cost with no matching benefit, paid at the exact moment a person was deciding whether the feature was worth the trouble.

The form past the toggle had its own teeth. A hand-pasted URL can carry a typo, and the dropdown can hold the wrong authentication method. Both fail at the far end of the OAuth handshake, which is a late place to learn about a first-screen mistake. Neither failure exists on a listing whose one control is Add.

## Underneath, the server that was already there

The plugin is the same MCP server the custom-connector route pointed at, [readplace.com/mcp](/mcp), wearing a directory entry. Nothing about the connection itself changed when the listing appeared. [MCP](/view/modelcontextprotocol.io) is the open protocol that lets an assistant call outside tools, and this server keeps its old shape: [no API key at any point](/blog/connect-ai-assistant-without-an-api-key), the client registers itself, one browser sign-in approves the connection, and the access can be revoked from your account whenever you want it gone.

Nothing moved for the other assistants either. Claude takes the same address as a custom connector, the Gemini CLI adds it with one command, and the hand-built ChatGPT route still works for anyone who would rather hold the URL themselves.

TBH, one gate stays out of my hands: which ChatGPT plans can see the directory. That switch belongs to OpenAI, so the install page makes no promise about it. The server URL sits directly under the Add button for any account the listing skips.

## Where to press Add

The listing lives in [ChatGPT's plugin directory](https://chatgpt.com/plugins/plugin_asdk_app_6a7c5944b14c8191ac9a1582ba78348a), and [the install page](/install?client=chatgpt) keeps both routes on one panel, the plugin leading and the bare server URL beneath it. A third route needs no menus at all: tell ChatGPT "Connect to readplace.com so you can save pages to and read my reading list" and it walks itself through the sign-in.

After that, the next article worth keeping is a sentence away from [your queue](/). "Save this to my readplace", said mid-chat, and the link is in the pile with [its summary on the way](/blog/stop-copy-pasting-articles-into-chatgpt).
