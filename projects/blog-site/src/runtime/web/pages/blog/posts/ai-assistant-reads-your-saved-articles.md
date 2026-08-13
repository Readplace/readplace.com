---
title: "Your AI Assistant Can Read Your Saved Articles and Mark Them Read"
description: "Connect an AI assistant to Readplace and it can read your saved articles: the cleaned reader text and the AI summary, looked up by id. It can also mark one read or unread, the same write the app makes and just as easy to undo. Deleting is the one thing that stays with you."
slug: "ai-assistant-reads-your-saved-articles"
date: "2026-06-22"
lastModified: "2026-08-12"
author: "Fayner Brack"
keywords: "AI assistant read saved articles, Claude read it later, ChatGPT read saved articles, MCP read article content, get_article_content, mark_as_read, mark_as_unread, mark an article read from your assistant, AI summary of saved article, Readplace MCP, read your reading list with AI, MCP read it later"
tags: ["changelog"]
banner: "Your AI assistant can now read your saved articles and mark them read"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

An assistant connected to Readplace used to do two things: save a page to your queue and list back what you saved. It can now open a saved article and read it, the cleaned reader text and the AI summary, looked up by the id from your list. It can also mark that article read, or unread again. Marking read shipped as a tool that refused, and I changed my mind: it is an ordinary write you ask for, and one call to `mark_as_unread` puts it back where it was. Deleting is the one tool that still only hands the assistant a note pointing you at the app, and every lookup, read or write, is tied to your account. The per-client setup is the same one page as before, at [readplace.com/mcp](https://readplace.com/mcp).

</div>
</details>

An AI assistant connected to Readplace can now read every word of an article you saved, and mark it read once you have. It still can't delete it.

Reading the article was the whole of this when I first shipped it, and marking read was a tool I deliberately built to refuse. I changed my mind about that half, and the section below says why. Deleting stays where it is, on purpose.

## What the assistant can read now

Until now a connected assistant had two tools, the [save-and-list pair I wrote about before](/blog/save-articles-with-your-ai-assistant). One saved a page to your queue. The other listed what you had saved, by title and not much more.

Listing is not reading. The assistant could tell that you saved a piece on, say, interest rates, but it could not open it. To use the article it had to go back to the live page, meet the same paywall or pop-up you saved the page to avoid, and read whatever the site served the second time.

Three tools close that gap. `get_article` returns one saved article's details: title, site, word count, estimated read time, and the dates you saved and read it. `get_article_content` returns the cleaned reader text, the same quiet copy Readplace built for you, ads and scripts already gone. `get_article_summary` returns the short summary Readplace wrote when the save finished. Each one works off the copy on Readplace's servers, not the open web.

## Two tools that move an article, one that changes nothing

The connection carries three more tools, and they do not all act alike.

`mark_as_read` and `mark_as_unread` do what they read like. One flips a saved article to read, the other flips it back and clears the read date with it. Both take a single id from your listing and change the same row the app changes when you tap the button in your queue, so a mark you make in a conversation shows up in the browser and on your phone.

`delete_article` is the one left standing still. It reads like it removes an article, and it doesn't. Call it and your library stays exactly where it was. The tool answers with a short note saying deleting happens in the Readplace app, and you do it.

> **Your assistant can move an article through your list. It cannot take one out of it.**

Every lookup is tied to your account, and that holds for the two writes as much as for the reads. An assistant signed in as you reaches your articles and no one else's, so a wrong or guessed id comes back as not found rather than someone else's reading.

## Marking an article read: I changed my mind

The read mark was the one thing I most wanted to keep out of the assistant's hands when this shipped, and it is worth saying why before saying what changed.

Readplace is a place to read the web. Reading a piece and asking an assistant to condense it are not the same act, and the read mark belongs to the first. The worry was the easy path: have the assistant skim the piece, hand you a few lines, tick the box, and your reading list fills with read marks over articles you never read.

That worry was about an assistant marking things off its own bat. It was never about you asking for it. Refusing the tool did nothing about the first. An assistant inclined to tick a box it shouldn't is not held back by a note telling it to open the app. And it did stop the second, which is the ordinary case: you finish the piece, you are already in the conversation about it, and the app is one more trip.

So marking read is a normal write now. `mark_as_read` sets the mark, `mark_as_unread` clears it and the read date with it, and a mark you did not want costs one sentence to undo, the same [one-tap undo](/blog/mark-articles-read-undo-in-one-tap) the queue already gives you. What is left of the old caution now lives in what the tool tells the assistant rather than in a refusal: the description says plainly that a summary it produced is not the same as you having read the piece, and that the mark is for when you have read it or when you ask. That is guidance, and I would rather call it guidance than keep a refusal that was only ever stopping the honest case.

## Why advertise a tool that refuses

The simpler move is to leave it out. If the assistant can't delete, why give it a delete tool at all?

Because the missing tool gives a worse answer. Ask an assistant that has no delete tool to remove an article, and it improvises. It might say it deleted the thing, or fail in a way you can't read, or reach for `save_link` because that is the nearest tool it has. A tool that exists and declines hands it a fact to pass on: this happens in the app, and here is the reason. You get a straight answer in place of a confident wrong one. That is why `delete_article` is still on the list while doing nothing at all.

The other tools follow the same habit. While Readplace is still fetching the reader copy, `get_article_content` says it is not ready yet instead of failing, so the assistant tells you to wait a moment rather than reporting an empty article.

## A reader your assistant can work over

People pay for Claude, ChatGPT, and Perplexity to read things and boil them down. That help used to stop at the edge of your saved reading, since the assistant could see the list but not the words on it.

Now you can ask it to read the three pieces you saved this week and tell you which one to start with. You can ask which saved article made a point you half remember, and it can check the text rather than guess from a title. Finish one and you can say so in the same breath, and your queue moves without you going anywhere. The reading you set aside turns into something you and the assistant can work through together.

A reading list pays off in the stretch between saving an article and getting to it. An assistant that reads the list for you makes that stretch shorter. One that could also empty it would only add risk to the same place.

Reading your saved articles, and moving them along as you get through them, is the half I gave the assistant. Emptying the list is the half I kept.

The setup is the same one page for every client, at [readplace.com/mcp](https://readplace.com/mcp), and it still asks for [no API key](/blog/connect-ai-assistant-without-an-api-key), only a sign-in you approve. Connect once, then ask your assistant to read back something you saved.
