---
title: "Save Articles to Readplace Straight From Your AI Assistant"
description: "Readplace runs an MCP server. Connect Claude, ChatGPT, Perplexity, or any MCP client, then ask it to save a page to your reading queue or list what you have saved. You log in once with OAuth, and your assistant does the rest."
slug: "save-articles-with-your-ai-assistant"
date: "2026-06-16"
author: "Fayner Brack"
keywords: "MCP server, Model Context Protocol, Claude MCP, ChatGPT MCP, Perplexity MCP, read it later MCP, save articles AI assistant, AI reading queue, save_link tool, OAuth MCP, Readplace MCP"
tags: ["changelog"]
banner: "Save articles to your queue from your AI assistant"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Readplace runs an MCP server at `readplace.com/mcp`. Connect Claude, ChatGPT, Perplexity, or another MCP client and your assistant gets two tools. `save_link` adds a page to your reading queue. `list_queue` reads back what you have saved. You approve a one-time OAuth login, so the assistant acts on your account without holding your password. The step-by-step for each client lives at [readplace.com/mcp](https://readplace.com/mcp).

</div>
</details>

You ask your AI assistant about a topic. It points you to a good article. You want to read it later, not now. So you copy the link, switch apps, and paste it somewhere. Readplace drops that step. Ask your assistant to save the page, and it lands in your queue.

## A reading queue your assistant can reach

Readplace runs an MCP server at `readplace.com/mcp`. MCP stands for Model Context Protocol, a shared way for AI assistants to call outside tools. Claude, ChatGPT, Perplexity, and other MCP clients speak it. Connect Readplace once, and your assistant gets two tools.

The first is `save_link`. Give it a web address and it saves the page to your queue. Articles, blog posts, and PDFs all work. The title, a short excerpt, and a clean reader view fill in a few seconds later, so the card shows up right away and finishes on its own.

The second is `list_queue`. It reads back what you have saved. Ask for the full list, or filter to unread or already-read items. Your assistant can pull up your backlog and help you pick what to read next.

## You stay in control of your account

Connecting an assistant should not hand over your password. It does not here. Readplace uses OAuth. Your assistant sends you to a Readplace login. You approve once. It receives a token tied to your account, and your password does not pass through it. You can revoke that token whenever you want, and the connection stops.

## How to connect

Each assistant has its own connector settings, but the shape is the same everywhere: paste the Readplace server URL, choose OAuth, and approve the login. The full walkthrough for Claude, ChatGPT, Perplexity, and developer tools like Claude Code, Cursor, and VS Code lives on one page: **[readplace.com/mcp](https://readplace.com/mcp)**. It is the canonical guide, so it stays current as each client evolves.

## Why this helps you

People ask assistants like Claude to find articles, summarise them, and keep them. The keep step used to mean leaving the chat and doing it by hand. With the MCP server, the assistant does it inside the conversation. Your reading list grows as you talk, and every saved page gets the same clean reader view and summary as one you save yourself.

Want to try it? Follow the steps at [readplace.com/mcp](https://readplace.com/mcp), or [install the browser extension](https://readplace.com/install) and start saving. Your assistant can take it from there.
