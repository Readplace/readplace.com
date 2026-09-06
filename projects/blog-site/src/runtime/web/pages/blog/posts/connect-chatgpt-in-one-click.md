---
title: "Connect ChatGPT to Your Reading List in One Click"
description: "ChatGPT can save a page to your Readplace readlist, read back a saved article's clean copy and its TL;DR, surface related saves, and mark one read. Connecting it used to mean turning on Developer Mode and hand-building a custom connector. Readplace is an official ChatGPT plugin now, so the setup is an Add button and one sign-in."
slug: "connect-chatgpt-in-one-click"
date: "2026-08-18"
author: "Fayner Brack"
keywords: "connect chatgpt to reading list, readplace chatgpt plugin, official chatgpt plugin, chatgpt read it later, save articles from chatgpt, chatgpt readlist, chatgpt mcp connector, add readplace to chatgpt, ai assistant reading list, pocket alternative chatgpt"
tags: ["changelog"]
banner: "I made ChatGPT one click away from your readlist"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

ChatGPT's plugin directory now carries an official Readplace listing. Adding it is an Add button and one sign-in, and a connected chat can then save a page to your readlist, list what is waiting in it, read back a saved article's clean copy and its TL;DR, hand you other saves that relate to it, and mark one read or unread. Deleting stays in the app: the tool for it removes nothing and points you back to Readplace. The route this replaces was a walkthrough that opened on a toggle called Developer Mode, then asked you to build a custom connector by hand, paste in a server URL, and pick the authentication method yourself. That walkthrough still works if you want it, and Claude and the Gemini CLI connect to the same server exactly as they did before.

</div>
</details>

ChatGPT can save an article to a Readplace readlist, list what is waiting in it, read back a saved article's clean copy and its TL;DR, and mark one read when it is finished. It has been able to do that since June.

Getting it connected took a walkthrough.

That walkthrough is retired. OpenAI approved Readplace as an official ChatGPT plugin, so the connection is a listing in ChatGPT's plugin directory with a single control on it.

Open the listing, choose Add, approve the sign-in. [The install page](/install?client=chatgpt&utm_source=blog-connect-chatgpt-in-one-click&utm_medium=internal&utm_content=install-chatgpt) carries the same button under the label Add Readplace to ChatGPT.

## The 9 tools behind the chat

A connected chat reaches 9 tools on the Readplace [MCP](/view/modelcontextprotocol.io?utm_source=blog-connect-chatgpt-in-one-click&utm_medium=internal&utm_content=read-modelcontextprotocol-io) server, and 8 of them do what they say. [Saving a link](/blog/save-articles-with-your-ai-assistant?utm_source=blog-connect-chatgpt-in-one-click&utm_medium=internal&utm_content=post-save-articles-with-your-ai-assistant) puts the URL in your readlist and lets the title, the clean copy, and the TL;DR fill in behind it, the same way a save from the browser extension does. Listing the readlist reads back what is waiting, filtered to unread or already read. [Reading one back](/blog/ai-assistant-reads-your-saved-articles?utm_source=blog-connect-chatgpt-in-one-click&utm_medium=internal&utm_content=post-ai-assistant-reads-your-saved-articles) returns its details, its clean text, or its TL;DR, depending on which you asked for.

A newer one hands over [other saves in your own readlist that relate to an article](/blog/the-next-read-under-your-article-stopped-guessing?utm_source=blog-connect-chatgpt-in-one-click&utm_medium=internal&utm_content=post-the-next-read-under-your-article-stopped-guessing), each tagged unread or read and carrying a short reason. Marking read and marking unread make the same write the app makes, so a swipe in the iPhone app and a sentence in a chat land in the same place.

The 9th refuses. Ask a connected ChatGPT to delete a saved article and the tool answers with a note pointing you back to Readplace, because it removes nothing. Deleting is the one action on a saved article with no way back, and [the website itself now asks before it happens](/blog/confirm-before-deleting-a-saved-article?utm_source=blog-connect-chatgpt-in-one-click&utm_medium=internal&utm_content=post-confirm-before-deleting-a-saved-article). Handing that to an assistant would have skipped the question.

## A switch named for someone else

Until the listing existed, the first step in the ChatGPT connection guide read: open Settings, then Apps & Connectors, then Advanced, and turn on Developer Mode. 3 more steps followed it. Add a custom connector, paste in the Readplace server URL, choose OAuth as the authentication method.

Developer Mode is for people testing a connector they are writing themselves. Reaching a finished product through it was a borrowed workflow, and it asked for the flip before a single article got saved.

> **Developer Mode is an honest label, and that was the problem.**

The form past the toggle had its own teeth. A pasted URL can carry a typo, and the dropdown can hold the wrong authentication method. Both fail at the far end of the OAuth handshake, which is a late place to find out about a first-screen mistake. A listing whose one control is Add has nowhere to put either of them.

TBH the guide was breaking its own rule to describe that path at all. It avoids naming menus on purpose, because menu labels move and the words rot where they sit. ChatGPT's card was the one that had to name them, and every rearrangement of those settings walked my instructions a little further from the screen in front of you. A listing OpenAI hosts itself does not drift that way.

## The homework that came with approval

ChatGPT checks that a plugin's listing and the domain behind it answer to the same operator. So readplace.com serves the token that check reads, at `/.well-known/openai-apps-challenge`. A reader has no reason to look at it. It is what lets the listing say Readplace and mean it.

The sign-in is the only credential anywhere in the flow. ChatGPT registers itself with the server, you approve one browser login, and [no API key changes hands](/blog/connect-ai-assistant-without-an-api-key?utm_source=blog-connect-chatgpt-in-one-click&utm_medium=internal&utm_content=post-connect-ai-assistant-without-an-api-key). Revoke that access from your account and the plugin goes dark the moment you do.

## The routes that did not change

A directory listing exists per assistant, and ChatGPT's is the one Readplace holds. Claude adds the same address as a custom connector, the Gemini CLI adds it with one command, and [the connection guide](/mcp?utm_source=blog-connect-chatgpt-in-one-click&utm_medium=internal&utm_content=mcp) still walks through both.

The hand-built ChatGPT route works too. The server URL sits under the Add button on the install page for anyone who would rather wire it up personally, and a connector built back when that was the only door points at the same server and the same account.

So does the shortest route of all. Paste "Connect to readplace.com so you can save pages to and read my reading list" into a chat, and [ChatGPT finds the server on its own](/blog/ai-agents-discover-readplace?utm_source=blog-connect-chatgpt-in-one-click&utm_medium=internal&utm_content=post-ai-agents-discover-readplace).

## Where the Add button lives

[The listing](https://chatgpt.com/plugins/plugin_asdk_app_6a7c5944b14c8191ac9a1582ba78348a) sits in ChatGPT's plugin directory, and [the install page](/install?client=chatgpt&utm_source=blog-connect-chatgpt-in-one-click&utm_medium=internal&utm_content=install-chatgpt) keeps both routes on one panel, the plugin leading and the server URL underneath. Add it, then hand ChatGPT a link mid-conversation and ask it to keep the article. It lands in [your readlist](/?utm_source=blog-connect-chatgpt-in-one-click&utm_medium=internal&utm_content=home) with its TL;DR filling in behind it, and the chat carries on without you leaving it.
