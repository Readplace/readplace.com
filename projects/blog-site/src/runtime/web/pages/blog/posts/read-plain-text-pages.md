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

I saved a Project Gutenberg book to my readlist. The card showed up, the AI summary landed under it a few seconds later, and then I tapped to read and got a screen that told me the link was not a webpage. Readplace had fetched the file and summarised it, so the work was done, but the part I wanted, reading it, was the part it blocked.

That bug is fixed now. Plain text pages open in the same reader you use for articles and PDFs.

## Why a finished summary still showed an error

Here is what was happening underneath. A web page arrives as HTML, full of tags that mark where a heading starts and where a paragraph ends, and the reader leans on those tags to lay the page out.

A book from Project Gutenberg, or an old RFC, arrives as raw text with none of that markup.

Readplace knew how to handle HTML and it knew how to handle PDFs. A `.txt` link matched neither, so it fell through to an unsupported bucket and hit the fallback screen.

The summary was sitting right behind that screen, finished, with no door to it.

The fix turned out to be smaller than the bug felt. Before the reader runs, Readplace now prepares the text: it pulls a title from the link, splits the body into paragraphs wherever it finds a blank line, then feeds that through the same reader steps as an article or a PDF.

You end up with a title, clean paragraphs, and a short summary at the top.

## Where this helps

Project Gutenberg holds over 70,000 free books, most of them served as plain text. Save one to your readlist and read it with a summary, the same as any article.

The RFCs that describe how email and the web actually work also ship as plain text. Save the one you keep meaning to get to.

Meeting transcripts, mailing-list archives, and README files served raw all behave the same way now.

If the page is text, Readplace will read it.

## A small guard against the next gap

I also added something to stop this class of bug coming back. Readplace keeps a single list of the file types it can read. The code that picks a reader for each type has to handle every entry on that list, or the build fails before it ships. Adding a new type is a one-line change, and if anyone adds a type without wiring up its reader, the compiler stops them.

So the failure mode I hit, a known file type with no reader behind it, gets caught at build time instead of in your hands.

For you that means fewer dead ends like this one.

## Try it

Open Project Gutenberg, pick a book, and copy its plain text link. Paste it into your Readplace readlist.

It reads like any other saved article, summary and all. Start at [readplace.com](/).
