---
title: "Connect ChatGPT to Your Reading List in One Click"
description: "ChatGPT can save articles to your Readplace queue, read your saved copies and their summaries, and mark them read. Connecting it used to mean turning on Developer Mode and building a custom connector by hand. Readplace is an official ChatGPT plugin now, so the whole setup is opening the listing, choosing Add, and approving one sign-in."
slug: "connect-chatgpt-in-one-click"
date: "2026-08-16"
author: "Fayner Brack"
keywords: "readplace chatgpt plugin, chatgpt read it later, connect chatgpt reading list, save articles from chatgpt, chatgpt plugin directory, chatgpt custom connector, MCP server chatgpt, ai assistant reading queue, read it later chatgpt plugin"
tags: ["changelog"]
banner: "I put your reading queue one click away inside ChatGPT"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Inside ChatGPT's plugin directory there is now an official Readplace listing. Adding it takes one click and one OAuth sign-in, and from then on ChatGPT can save pages to your reading queue, list what is waiting, read a saved article's clean copy and its summary, and mark articles read or unread. The old route to the same connection was a walkthrough: turn on Developer Mode in ChatGPT's web settings, build a custom connector by hand, paste in a server URL, and pick the authentication method yourself. That walkthrough is no longer required, and the server behind the connection is the same one it reached before.

</div>
</details>

Ask ChatGPT to save an article for later, and it knows what to do. It has known since June. What stood in the way was the setup: opening ChatGPT's web settings, finding Advanced under Apps & Connectors, switching on Developer Mode, building a custom connector by hand, pasting in a server URL, and picking OAuth as the authentication method. The name of that switch says who those steps were written for.

The connection runs over an [MCP server](/view/modelcontextprotocol.io), and any assistant that speaks the protocol can work your queue through it. The audience was whoever could finish that walkthrough, and the walkthrough was written in a developer's vocabulary.

> **The setup screen decides who a feature is for.**

## One click where the walkthrough was

OpenAI approved Readplace as an official ChatGPT plugin.

The setup that replaces the walkthrough is short enough to write out in full: open [the Readplace listing](https://chatgpt.com/plugins/plugin_asdk_app_6a7c5944b14c8191ac9a1582ba78348a) in ChatGPT, choose Add, and complete the OAuth sign-in. There is no Developer Mode to find, no connector form to fill, and no URL to paste.

Approval came with homework. ChatGPT checks that a plugin's listing and the domain behind it belong to the same operator, so readplace.com now serves the verification token that check reads. A reader will not see it, and it is why the listing can say Readplace and mean it.

The sign-in is the only credential in the whole flow. ChatGPT registers itself with the server and you approve one OAuth login, [with no API key to copy](/blog/connect-ai-assistant-without-an-api-key) and no password handed over. Revoke that access from your account later and the plugin goes dark the moment you do.

## The same server, wearing a listing

The plugin is a directory entry in front of the MCP server that was already there, not a second integration. A chat connected through it can do what a connected assistant could do before: save a page to your queue mid-conversation, list what is waiting, [read a saved article's clean copy and its summary](/blog/ai-assistant-reads-your-saved-articles), and mark one read or unread with the same write the app makes.

If you built the custom connector back when that was the only door, nothing breaks. Both paths land on the same server and the same account. The plugin is that connector minus its setup, and the setup was most of it.

The prompt route still works too. Paste "Connect to readplace.com so you can save pages to and read my reading list" into a chat, and ChatGPT will find its own way to the server. The listing is the shorter road, but it is not the only one.

## Claude and Gemini still take the long way

A directory listing exists per assistant, and ChatGPT's is the one Readplace holds today. Claude and Gemini connect to the identical server through their own manual steps, and [the connection guide](/mcp) keeps walking through each one. TBH the manual path is not going away: it is what the plugin stands on, and it is how the next assistant will meet Readplace before any directory has an opinion.

## Ask it what's in your queue

A connected ChatGPT turns your reading list into something you can talk to. Save a link without leaving the conversation, or have the article you filed this morning summarised back at you over lunch. The listing sits one click from [the install page](/install?client=chatgpt), and adding it takes less time than the old walkthrough took to read. If the queue it would answer about is still empty, a first save at [readplace.com](/) gives it something to say.
