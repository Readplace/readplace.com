---
title: "Your AI Assistant Finds Readplace in DNS, Before It Loads a Page"
description: "Readplace publishes agent-discovery records in DNS, so an AI assistant can find your readlist's tools the same way a browser finds the site. Readplace signs the zone with DNSSEC, so the agent trusts the answer it gets back."
slug: "ai-assistant-finds-readplace-in-dns"
date: "2026-06-19"
author: "Fayner Brack"
keywords: "AI agent discovery, DNS-AID, DNS for AI discovery, SVCB record, MCP server discovery, read it later AI agent, agent discovery DNS, DNSSEC, find API from DNS, AI assistant reading list"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Readplace now answers a question in DNS that AI agents used to guess at: where do my reading tools live? Two records under `_agents.readplace.com` point an assistant to the front door and to the save tool. The agent reads DNS, follows the record, and lands on the right page with no setup from you. Readplace signs the zone with DNSSEC, so the agent gets an answer it can verify rather than a forged one. You ask your assistant to save an article, and it finds Readplace the rest of the way.

</div>
</details>

You tell your AI assistant to save an article for later. First it has to find the right service. Most apps make the assistant guess, or make you paste an address and copy a key by hand. Readplace now answers that question in DNS, the same system that turns a web address into a server.

## A phone book entry for agents

Every time you open a site, your computer asks DNS for its address. DNS is the web's phone book. Readplace adds two extra entries to its own listing, under a name set aside for agents: `_agents.readplace.com`.

The first record, `_index`, sends an agent to the apex. There it reads the discovery files: the OAuth login, the docs written for machines, and the skills index. The second record, `_mcp`, sends the agent to the MCP endpoint, where it picks up the tools to save a link and list your readlist. An agent reads DNS, follows the record, and arrives at the right page with no setup from you.

## Why DNS and not just a link

Readplace already advertises its agent tools in an HTTP header on every page. That works once an agent has the page open. DNS works one step earlier. An assistant can ask DNS where Readplace keeps its tools before it loads a single byte of the site. The answer comes back in a few hundred bytes, so the assistant skips a round of trial and error.

## An answer the agent can trust

A phone book helps only if no one tampers with the entries. Readplace signs its DNS zone with DNSSEC. A signed zone lets a resolver check two things: the answer came from Readplace, and it reached the agent unchanged. So when your assistant asks where to save your reading, it gets a reply it can verify, not one a stranger forged to point somewhere else.

This matters for a read-it-later app. The agent is about to act on your account. A trustworthy answer at the discovery step keeps your saved articles going to your readlist and nowhere else.

## What this means for your reading

You use Claude, ChatGPT, or another assistant, and you want it to reach your saved articles and act on them. The less setup that takes, the more often you actually do it. With these records in place, an agent finds Readplace on its own, asks for your approval through OAuth, then saves a page to your readlist inside the chat. You stop copying links between apps.

This builds on two things Readplace shipped already. Your assistant can [save articles through the MCP server](/blog/save-articles-with-your-ai-assistant), and it reads the [discovery files](/blog/ai-agents-discover-readplace) that describe the API in plain text. The DNS records put those same tools one step closer, so the agent reaches them before it ever opens the site.

Ask your assistant to save your next article, and let it find Readplace the rest of the way. [Install the browser extension](https://readplace.com/install) or start at [readplace.com](/).
