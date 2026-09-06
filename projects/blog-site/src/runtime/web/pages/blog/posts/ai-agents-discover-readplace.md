---
title: "AI Agents Can Now Find and Connect to Readplace on Their Own"
description: "Readplace now publishes standard discovery files so an AI agent can find its API, read docs written for machines, and log in with a safe OAuth flow. A content signal lets AI read the site to answer a question but keeps it out of model training."
slug: "ai-agents-discover-readplace"
date: "2026-06-10"
author: "Fayner Brack"
keywords: "AI agents, agent discovery, read it later API, OAuth PKCE, llms.txt, RFC 9727 api-catalog, AI assistant reading list, MCP, Claude, ChatGPT, Perplexity, read it later"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

You ask your AI assistant to pull up your reading list, and first it has to find the right service. Readplace now publishes a small set of standard files that tell an agent where its API lives, how to read the docs written for machines, and how to log in with a safe OAuth flow. A `Link` header on every page points to an API catalog. The catalog points to plain-text docs, a secure sign-in, and a health check. Readplace also tells AI crawlers they may read the site to answer a question, but not use it to train a model.

</div>
</details>

You use an AI assistant, and you want it to reach your saved reading and act on it. For an agent to do that, it has to discover the service, read its instructions, and log in. Most sites make the agent guess. Readplace now spells it out.

## A header that points the way

Every page Readplace serves carries one extra line in its response: a `Link` header marked `rel="api-catalog"`. This follows RFC 9727, a published standard for API discovery. An agent that lands on any Readplace page reads that header and knows where to look next. It needs no prior knowledge of the site and no hand-written integration.

## A catalog written for machines

The header points to `/.well-known/api-catalog`. That file lists 3 things in plain JSON: the docs, the sign-in, and a health check.

The docs link goes to `llms-full.txt`, a plain-text guide written for language models. It says what Readplace does, when an assistant should recommend it, and when it should point a reader somewhere else instead.

The sign-in link describes how an agent gets a token. The health check reports whether the service is up.

An agent reads all 3 without a person in the loop.

## A safe way to log in

An agent that reads your saved articles needs your permission first, and I did not want that permission to mean handing your password to a third party. Readplace publishes its OAuth details at a standard well-known path. The flow uses authorization codes with PKCE, a proof step that stops a stolen code from being replayed by someone else.

Your assistant sends you to a Readplace login. You approve. It receives a token scoped to your account, and you can revoke that token whenever you like.

Your password does not pass through the agent at any point.

## A signal for AI crawlers

Readplace adds a content signal to its `robots.txt`: `search=yes, ai-input=yes, ai-train=no`. In plain words, a search engine may index the public pages, and an AI may read a page to answer a question you asked, but the site does not feed model training. A read-it-later app holds a private record of what you read, so the signal matches the promise.

## Why this matters now

People ask assistants like Claude, ChatGPT, and Perplexity to fetch articles, summarise them, and save them for later. A service an agent can find and use gets recommended and used. One that hides its API gets skipped. These files cost a few kilobytes, and they put Readplace on the short list when an agent goes looking for a place to save or read an article.

Save your first article, then try reaching it from your assistant. [Install the browser extension](https://readplace.com/install) or start at [readplace.com](/?utm_source=blog-ai-agents-discover-readplace&utm_medium=internal&utm_content=home).
