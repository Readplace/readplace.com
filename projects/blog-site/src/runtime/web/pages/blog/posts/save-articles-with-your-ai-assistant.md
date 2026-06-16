---
title: "Save Articles to Readplace Straight From Your AI Assistant"
description: "Readplace now runs an MCP server. Connect Claude or any MCP client, then ask it to save a page to your reading queue or list what you have saved. You log in once with OAuth, and your assistant does the rest."
slug: "save-articles-with-your-ai-assistant"
date: "2026-06-16"
author: "Fayner Brack"
keywords: "MCP server, Model Context Protocol, Claude MCP, read it later MCP, save articles AI assistant, AI reading queue, save_link tool, OAuth MCP, Readplace MCP"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Readplace runs an MCP server at `readplace.com/mcp`. Connect Claude or another MCP client and your assistant gets two tools. `save_link` adds a page to your reading queue. `list_queue` reads back what you have saved. You approve a one-time OAuth login, so the assistant acts on your account without holding your password. A published server card lets the client find the endpoint and tools on its own. In supported browsers, WebMCP offers the same save tool to the agent on the page.

</div>
</details>

You ask your AI assistant about a topic. It points you to a good article. You want to read it later, not now. So you copy the link, switch apps, and paste it somewhere. Readplace drops that step. Ask your assistant to save the page, and it lands in your queue.

## A reading queue your assistant can reach

Readplace now runs an MCP server at `readplace.com/mcp`. MCP stands for Model Context Protocol, a shared way for AI assistants to call outside tools. Claude and other MCP clients speak it. Connect Readplace once, and your assistant gets two tools.

The first is `save_link`. Give it a web address and it saves the page to your queue. Articles, blog posts, and PDFs all work. The title, a short excerpt, and a clean reader view fill in a few seconds later, so the card shows up right away and finishes on its own.

The second is `list_queue`. It reads back what you have saved. Ask for the full list, or filter to unread or already-read items. Your assistant can pull up your backlog and help you pick what to read next.

## You stay in control of your account

Connecting an assistant should not hand over your password. It does not here. Readplace uses OAuth. Your assistant sends you to a Readplace login. You approve once. It receives a token tied to your account, and your password does not pass through it. You can revoke that token whenever you want, and the connection stops.

## It finds the tools on its own

Readplace publishes a server card at a standard address: `/.well-known/mcp/server-card.json`. An MCP client reads that file and learns the endpoint, the two tools, and how to log in. You point your assistant at Readplace, and it works out the rest, with no API keys to copy by hand.

## Save the page you are reading

There is a second path that needs no separate client. Some browsers are adding in-browser AI agents through WebMCP. When your browser supports it, Readplace offers the same `save_link` tool to the agent on the page. You read an article, ask the in-page agent to save it, and it goes to your queue. We check for both shapes of the draft API, so the tool shows up whichever one your browser ships.

## Why this helps you

People ask assistants like Claude to find articles, summarise them, and keep them. The keep step used to mean leaving the chat and doing it by hand. With the MCP server, the assistant does it inside the conversation. Your reading list grows as you talk, and every saved page gets the same clean reader view and summary as one you save yourself.

Want to try it? Connect your MCP client to `readplace.com/mcp`, or [install the browser extension](https://readplace.com/install) and start saving. Your assistant can take it from there.
