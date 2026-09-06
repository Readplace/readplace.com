---
title: "Connect Your AI Assistant to Readplace With No API Key to Copy"
description: "Connecting your AI assistant to Readplace needs no API key. The MCP client registers itself, you approve one OAuth sign-in, and you can revoke that access anytime. Then your assistant can save pages to your readlist and list them back."
slug: "connect-ai-assistant-without-an-api-key"
date: "2026-06-21"
author: "Fayner Brack"
keywords: "MCP OAuth, connect AI assistant no API key, dynamic client registration, RFC 7591, Claude MCP, ChatGPT MCP, Perplexity MCP, read it later MCP, MCP server OAuth, save articles AI assistant, revoke AI access"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Connecting a tool to your AI assistant usually starts with an API key, a secret you generate once and keep somewhere safe. Readplace's MCP server skips it. You point Claude, ChatGPT, Perplexity, or a developer client at `readplace.com/mcp`, the assistant registers itself, and Readplace sends you to a sign-in to approve the connection. You don't create a credential or hand one over, and you can revoke the assistant's access whenever you want. Once connected, the assistant can save a page to your readlist and read your list back.

</div>
</details>

Point your assistant at `readplace.com/mcp` and it introduces itself to the server. No secret changes hands.

Connecting a tool to an AI assistant usually runs the other way. You open a developer console, generate a long API key, and paste it into a settings box before anything talks to anything. Readplace has no box to paste into, because there is no key to make.

## What stands in for the key

Readplace runs an MCP server. MCP is the shared protocol that lets an AI assistant call outside tools, and Claude, ChatGPT, Perplexity, and developer clients like Claude Code and Cursor all speak it. To call a tool, the assistant first needs an identity the server recognises.

The manual way to get that identity puts a person in the loop. You register the application in a console, copy the client ID and secret it returns, and paste both into the assistant.

Readplace supports a step that drops the person from that loop. The assistant sends its own details to Readplace and gets its own identity back, on the spot. The standard for this is RFC 7591, dynamic client registration, and it runs as a couple of seconds of machine-to-machine talk you don't see.

That identity is not a password, and it is not enough on its own. The assistant sends you to a Readplace sign-in. You approve once. Readplace hands back a token tied to your account, the assistant acts with that token, and you can revoke it whenever you like.

> **There is no key to copy, because the assistant makes its own identity and you approve it once.**

## A missing secret is one that can't leak

An API key is a small liability you carry around. It sits in the assistant's settings, in a config file, sometimes in a screenshot from when you set things up. Anyone who reads it can act as you until you notice and rotate it.

A credential that doesn't exist can't sit in any of those places.

The token Readplace gives you after you sign in is scoped to your account and revocable from your settings. It is not a shared string you typed into a box. So the exposure is smaller. There is no long-lived secret in plain sight, and the access you granted ends the moment you withdraw it.

## What the connection is for

Setup is the part you do once. What matters is what comes after.

Once connected, your assistant gets two tools. `save_link` adds a page to your readlist, and the title, excerpt, and clean reader view fill in moments later, so the card shows up right away and finishes on its own. `list_queue` reads back what you have saved, filtered to unread or already read.

People pay for Claude, ChatGPT, and Perplexity to find articles and summarise them. The save step used to mean leaving the chat and doing it by hand. Now you ask in plain language, and the page lands in your readlist inside the conversation. Every page the assistant saves gets the same reader view and summary as one you save yourself.

The per-client steps live at [readplace.com/mcp](https://readplace.com/mcp), the same address you hand your assistant. Open it from the browser you read in and connect from there. For more on the server and the two tools, the [earlier writeup on saving from your assistant](/blog/save-articles-with-your-ai-assistant?utm_source=blog-connect-ai-assistant-without-an-api-key&utm_medium=internal&utm_content=post-save-articles-with-your-ai-assistant) goes deeper.
