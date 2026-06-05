---
title: "Readplace Now Reads Plain Text Pages"
description: "A .txt link, like a Project Gutenberg book or an old internet spec, used to show a 'not a webpage' error even after Readplace had read and summarised it. Now plain text opens in the same reader as web articles and PDFs."
slug: "read-plain-text-pages"
date: "2026-06-03"
author: "Fayner Brack"
keywords: "read it later, plain text, txt file, project gutenberg, rfc, reader view, save txt file, plain text reader, readplace"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Readplace now reads plain text pages. A `.txt` link used to show a "not a webpage" message, even though Readplace had already fetched and summarised it. Now plain text opens in the same reader as web articles and PDFs, with a title, readable paragraphs, and a short summary on top. That covers Project Gutenberg books, old internet specs, mailing-list archives, and any page served as raw text.

</div>
</details>

You paste a link to a plain text page. Maybe a classic book from Project Gutenberg, or an old technical spec kept as raw text. Readplace used to fetch the page, read it, and write a summary. Then it showed you a message that said the link was not a webpage. The work was done, but you had no way to read it.

That gap is closed. Plain text pages now open in the same reader you use for articles and PDFs.

## Why a finished summary still showed an error

A web page arrives as HTML, full of tags that mark headings and paragraphs. A book or a spec often arrives as plain text, with no tags at all. Readplace knew how to read HTML and PDFs, so a `.txt` link landed in an unsupported bucket and hit the fallback screen. The summary sat ready behind it, out of reach.

Now Readplace prepares the text before it reads it. It takes a title from the link, splits the text into paragraphs at the blank lines, and sends it through the same reader steps as the rest. You get a title, clean paragraphs, and a short summary at the top.

## Where this helps

Project Gutenberg holds over 70,000 free books, most of them as plain text files. Save one to your queue and read it with a summary, the same as any article.

Old internet standards, the RFCs that describe how email and the web work, ship as plain text too. Save the one you keep meaning to read.

Meeting transcripts, mailing-list archives, and README files served as raw text all work the same way now. If the page is text, Readplace will read it.

## A small guard against future gaps

The change came with a quiet bit of engineering. Readplace keeps one list of the file types it can read. The code that picks a reader for each type has to handle every entry on that list, or the app will not build. So adding a new type is a one-line change, and Readplace refuses to ship if any type is left without a reader. The result for you is fewer dead ends like the one this fixed.

## Try it

Open Project Gutenberg, pick a book, and copy its plain text link. Paste it into your Readplace queue. It will read like any other saved article, summary and all. Start at [readplace.com](/).
