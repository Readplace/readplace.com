---
title: "The Readplace API opens your reading list to your own scripts"
description: "The API behind the browser extensions and the phone apps is documented at readplace.com/developers. A script registers with 1 POST and no API key, saves links, reads each article back as Markdown with its summary and highlights, and hard-codes one URL, because the rest arrives in each answer."
excerpt: "A script against this API hard-codes one URL. Every other address arrives inside the answers."
tldr: "Anything that can send an HTTP request can now build on a Readplace account. The page at readplace.com/developers documents the API the browser extensions and the phone apps already run on: register with 1 POST and no API key, save links, read each article back as a Markdown document with its summary and the reader's highlights, and file articles into readlists. A script hard-codes the entry URL and a few names, reads every other address out of the answers, and a change to the API ships with its description on that page in the same commit."
slug: "build-on-the-readplace-api"
date: "2026-11-19"
author: "Fayner Brack"
keywords: "read it later api, readplace api, save articles api, read it later app with api, pocket api alternative, export saved articles as markdown, siren hypermedia api, oauth dynamic client registration, api without api key, automate reading list"
---

A script built on a web API usually begins as a list of copied paths. A path for sign-in, another for each list, each pasted from the docs on the day it was written. The paths are where the script rots: the provider moves an endpoint, and the 404s pile up in a cron log until somebody misses the output.

The Readplace API is built for that script to hard-code one address: `/`.

The documentation is now public at [readplace.com/developers](/developers?utm_source=blog-build-on-the-readplace-api&utm_medium=internal&utm_content=developers). It describes the API the Chrome and Firefox extensions and the iPhone and Android apps have been running on all along, with samples in HTTP, TypeScript and Swift.

The server learned almost nothing new for the occasion.

The page is the news, and so is the policy behind it: the page's own tests pin what it says against what the API answers, and a change to the API ships with its description there in the same commit.

## One URL and a short list of names

Each request sends a bearer token and asks for [Siren](/view/github.com/kevinswiber/siren?utm_source=blog-build-on-the-readplace-api&utm_medium=internal&utm_content=read-siren-spec), a JSON hypermedia format. `GET /` answers with the reading list itself, and inside that answer are the moves available next: the readlists, the tabs, the pages, a `save-article` action with its fields spelled out, a `read` link on each article.

> **Every answer carries the requests that can follow it.**

What a script hard-codes is short: the entry URL, the 2 media types, the names of the actions it invokes, the link rels it follows and the frontmatter keys it reads. The rest, every href, method and field list, arrives in the answers. An href is opaque, followed as given, built from nothing.

That rule is what lets the API grow without stepping on the integrations already running. A new action appears, and an old script skips it. An address changes shape, and the script picked the new one up on its last request.

When a kept href does answer 404, the recovery is in the docs too: start again from `/` and retry once.

## Registering is a POST, not a key to copy

There's no developer portal and no API key. A client registers the way AI assistants already register [for the MCP server](/blog/connect-ai-assistant-without-an-api-key?utm_source=blog-build-on-the-readplace-api&utm_medium=internal&utm_content=post-connect-ai-assistant-without-an-api-key): 1 POST to `/oauth/register` with the redirect URI the app listens on, per [RFC 7591](/view/datatracker.ietf.org/doc/html/rfc7591?utm_source=blog-build-on-the-readplace-api&utm_medium=internal&utm_content=read-rfc-7591), answers with a `client_id`. The reader approves the connection in their browser, through ordinary OAuth 2.0 with PKCE and no client secret.

Two things belong in the token code from day 1. There are no scopes, so an approved token acts as the reader everywhere the API reaches. And refresh tokens rotate, so the new pair gets stored before it gets used.

The reader stays in charge of the connection. A registered app shows under Connected apps in the account, and disconnecting it there cuts its tokens off.

## An article comes back as a Markdown document

Each article carries a `read` link. Followed with `Accept: text/markdown`, it answers with the article as one document: YAML frontmatter holding the title, the source URL and the statuses, the AI summary as a callout once it's ready, then the article's text.

When the reader has highlighted the article, the document ends with a Highlights section, each highlight quoted with its note. A highlight whose passage was edited says so, and one whose passage is gone is marked not found, the same states [the reader itself shows](/blog/highlights-and-notes-stay-on-their-passage?utm_source=blog-build-on-the-readplace-api&utm_medium=internal&utm_content=post-highlights-and-notes-stay-on-their-passage).

A pipeline that files reading into a vault, a wiki or a weekly digest gets the same text the reader gets, summary and marks included.

## A job that drains a readlist

The docs close on a worked example, and it's the one most worth copying: a scheduled job that files links into a readlist and later works through them.

The job creates its readlist once with `create-readlist` and keeps the href. Each link it saves goes through `save-article` with that href in the `readlists` field, so the save lands in All and in the job's list in 1 request. Later, the job opens the readlist, follows each article's `read` link, hands the Markdown on, and invokes `remove-from-readlist`, which takes nothing out of All.

A saved link answers `201` with the article. A tracking link that still needs unwrapping answers `409`, which means accepted and queued rather than failed, so the job's one obligation there is to not send the same save again.

## Deletion stays in the app

The page keeps a section for what the API refuses to offer.

There is no delete action: removing an article from a readlist is as far as a token reaches, and destroying an article stays a thing done by hand in the app. A token trusted to file and read cannot empty the library behind it.

There are also no webhooks and no feeds, so a sync is a poll. Search narrows by status, order, page and URL, not by text. The server picks the page size.

Not every integration fits inside that list. One that needs push, or full-text search over the archive, doesn't have its API here yet, and the page says so plainly instead of leaving the gap to be found in production.

## The first request to send

The page at [readplace.com/developers](/developers?utm_source=blog-build-on-the-readplace-api&utm_medium=internal&utm_content=developers-cta) reads top to bottom in one sitting, and its language tabs rewrite the samples in HTTP, TypeScript or Swift. Registration needs nothing beyond the POST, so the distance between reading the page and a `200` from `/` is one approval screen.

The token acts for a reader, and the reader starts at [readplace.com](/?utm_source=blog-build-on-the-readplace-api&utm_medium=internal&utm_content=home).
