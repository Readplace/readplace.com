---
title: "Your AI Assistant Can Read Your Saved Articles, Not Change Them"
description: "Connect an AI assistant to Readplace and it can now read your saved articles: the cleaned reader text and the AI summary, looked up by id. It still can't mark an article read or delete it, because those stay in the app. The assistant reads your whole reading list and changes none of it."
slug: "ai-assistant-reads-your-saved-articles"
date: "2026-06-22"
author: "Fayner Brack"
keywords: "AI assistant read saved articles, Claude read it later, ChatGPT read saved articles, MCP read article content, get_article_content, read only MCP tools, AI summary of saved article, Readplace MCP, read your reading list with AI, MCP read it later"
tags: ["changelog"]
banner: "Your AI assistant can now read your saved articles"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

An assistant connected to Readplace used to do two things: save a page to your queue and list back what you saved. It can now open a saved article and read it, the cleaned reader text and the AI summary, looked up by the id from your list. Marking an article read or unread, and deleting one, are offered as tools too, but they do nothing on their own. They hand the assistant a note that points you back to the app, because reading a piece is your own act and a summary is not the same as reading it. So the assistant reads everything in your reading list and changes none of it, and every lookup is tied to your account. The per-client setup is the same one page as before, at [readplace.com/mcp](https://readplace.com/mcp).

</div>
</details>

An AI assistant connected to Readplace can now read every word of an article you saved. It still can't mark it read for you, or delete it.

Both halves of that are deliberate. Reading the article is the new feature, and leaving the marking and the deleting to you is a line drawn on purpose.

## What the assistant can read now

Until now a connected assistant had two tools, the [save-and-list pair I wrote about before](/blog/save-articles-with-your-ai-assistant). One saved a page to your queue. The other listed what you had saved, by title and not much more.

Listing is not reading. The assistant could tell that you saved a piece on, say, interest rates, but it could not open it. To use the article it had to go back to the live page, meet the same paywall or pop-up you saved the page to avoid, and read whatever the site served the second time.

Three tools close that gap. `get_article` returns one saved article's details: title, site, word count, estimated read time, and the dates you saved and read it. `get_article_content` returns the cleaned reader text, the same quiet copy Readplace built for you, ads and scripts already gone. `get_article_summary` returns the short summary Readplace wrote when the save finished. Each one works off the copy on Readplace's servers, not the open web.

## Three tools that change nothing

The connection carries three more tools, and all three are built to do nothing.

`mark_as_read` and `mark_as_unread` read like they flip an article between read and unread. `delete_article` reads like it removes one. Call any of them and your library stays exactly where it was. The tool answers with a short note: marking and deleting happen in the Readplace app, and you do them.

> **The assistant reads the whole of your reading list and changes none of it.**

Every lookup is tied to your account. An assistant signed in as you reaches your articles and no one else's, so a wrong or guessed id comes back as not found rather than someone else's reading.

## Marking an article read is yours to do

Of those three, the read mark is the one I most wanted to keep out of the assistant's hands, and it is worth saying why.

Readplace is a place to read the web. Reading a piece and asking an assistant to condense it are not the same act, and the read mark belongs to the first. If the assistant could set an article read, the easy path would be to have it skim the piece, hand you a few lines, and tick the box, and your reading list would fill with read marks over articles you never read.

So marking read stays a deliberate step, and the choice to take it is yours. You read the article, you open the app, and you mark it yourself. An assistant is a real help around the reading, before it and after, but it is not a stand-in for it. Readplace will not make it easy to call a piece read when all you did was have it summarised.

## Why advertise a tool that refuses

The simpler move is to leave them out. If the assistant can't delete, why give it a delete tool at all?

Because the missing tool gives a worse answer. Ask an assistant that has no delete tool to remove an article, and it improvises. It might say it deleted the thing, or fail in a way you can't read, or reach for `save_link` because that is the nearest tool it has. A tool that exists and declines hands it a fact to pass on: this happens in the app, and here is the reason. You get a straight answer in place of a confident wrong one.

The read tools follow the same habit. While the reader copy is still being fetched, `get_article_content` says it is not ready yet instead of failing, so the assistant tells you to wait a moment rather than reporting an empty article.

## A reader your assistant can work over

People pay for Claude, ChatGPT, and Perplexity to read things and boil them down. That help used to stop at the edge of your saved reading, since the assistant could see the list but not the words on it.

Now you can ask it to read the three pieces you saved this week and tell you which one to start with. You can ask which saved article made a point you half remember, and it can check the text rather than guess from a title. The reading you set aside turns into something the assistant can move through, and the most it can do to any of it is read.

A reading list pays off in the stretch between saving an article and getting to it. An assistant that reads the list for you makes that stretch shorter. One that could also empty it would only add risk to the same place.

Reading your saved articles is the half I gave the assistant. Changing them, by marking them read or deleting them, is the half I left with you.

The setup is the same one page for every client, at [readplace.com/mcp](https://readplace.com/mcp), and it still asks for [no API key](/blog/connect-ai-assistant-without-an-api-key), only a sign-in you approve. Connect once, then ask your assistant to read back something you saved.
