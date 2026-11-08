---
title: "Highlights that find their sentence again when the page changes"
description: "Highlights and notes are in the Readplace reader, on the web and in the iPhone app. Each mark is stored as the quote it covers, so when a page's stored copy changes, Readplace finds the passage again, keeps a lost mark as \"Not found in this version\" instead of guessing, and carries every mark into the markdown, the EPUB and the account export."
tldr: "Highlights and notes are in the reader for any account that can save, on the web and in the iPhone app. Readplace stores each mark as the exact words it covers plus the text around them, and when a page's stored copy changes, it searches the new text for that quote. A mark it can't place again is kept and labelled \"Not found in this version\" rather than moved to a near miss. The marks travel into the markdown download, the EPUB and the account export, and an AI assistant connected over MCP can list them or make one from a quote."
excerpt: "Paper holds still under a pencil line. Web pages don't, so a highlight is stored as its quote."
slug: "highlights-find-their-sentence-again"
date: "2026-11-08"
author: "Fayner Brack"
keywords: "highlight articles online, read it later app with highlights and notes, annotate saved articles, web highlighter that keeps highlights, highlights lost when article changes, export highlights markdown epub, highlight articles on iphone, pocket alternative with highlights, readplace"
---

Printed books hold still. The pencil line under a sentence in a paperback is under that same sentence 10 years later, because paper doesn't rewrite itself.

Web pages do. An edited paragraph, a late correction or a full redesign can replace the copy a mark was made on, and a highlight pinned to character 2,841 of the old text ends up midway through the wrong paragraph.

Highlights and notes arrived in the Readplace reader this week, on the web and in the iPhone app, for any account that can save. They're built around that problem: Readplace stores each mark as the words it covers, with the text around them, and not as a place on the page.

## Marking a passage

Select a passage in the reader and a small toolbar appears with 2 buttons, Highlight and Add note, and a Beta badge beside them. Highlight draws the mark in the reader's 1 colour. Add note attaches a short note to the same mark.

On a phone, a tap on a sentence selects the whole sentence. The tap replaces dragging selection handles across a 6-inch screen to catch the end of a quote.

Each mark is also listed in a Highlights card in the reader's rail, with its quote, its note and a Jump link that scrolls the page back to the passage. An account that can save an article can highlight one.

## Stored as the quote

A saved article's body isn't frozen. The body is shared by the readers who save the same URL, and a recrawl or a refresh can replace it with a newer copy of the page.

When that happens, Readplace re-anchors each highlight by searching the new text for its quote in context.

A staging run on 7 November re-anchored 185 highlights across 37 articles whose pages had been crawled twice. 29% of the marks could stay where they were. 60% had to move, almost all of them the exact quote found at a new position. A highlight stored as a position would have pointed at the wrong text in 6 cases out of 10 after a single recrawl.

The last 11% couldn't be found at all, and each of those came from 1 archived page whose stored versions alternate between 2 different pages.

## A lost mark says so

That 11% is the case that decides whether the other 89% can be trusted.

A highlight whose passage can't be found again is kept, quote and note intact, and listed in the rail under the chip "Not found in this version". It isn't moved to the closest look-alike, and it isn't deleted.

> **A mark that jumps to the wrong sentence costs more than a mark that says it's lost.**

The matching thresholds came out of those real recrawled pairs, and a change to them waits for a new measurement. TBH, the Beta badge is earned: odd pages will keep turning up, and the archived page that alternates between 2 versions is unlikely to be the strangest one out there. A page that re-anchors a mark somewhere wrong is worth an [email](mailto:readplace@readplace.com).

## The marks go in the downloads

The markdown download of an article you own ends with a Highlights section, each quote with its note under it.

[The EPUB download](/blog/read-your-saved-articles-on-a-kindle-or-kobo?utm_source=blog-highlights-find-their-sentence-again&utm_medium=internal&utm_content=post-read-your-saved-articles-on-a-kindle-or-kobo) marks each passage inside the book's text and closes with the same list. A mark that couldn't be placed shows up there with "(not found in the current version)" after its quote.

[The account export](/export?utm_source=blog-highlights-find-their-sentence-again&utm_medium=internal&utm_content=export), the JSON file that lists your saved articles, carries each article's highlights and notes as well.

## An assistant highlights by quoting

Claude and Gemini read the same account over MCP, and 2 tools cover the marks. `list_highlights` returns the highlights and notes in 1 saved article. `create_highlight` makes a new one from a quoted passage, with an optional note.

The quote has to match the article's text in 1 place. A quote that matches nothing, or matches more than once, is refused rather than guessed at, so an assistant can't invent a mark the article doesn't support. 2 overlapping marks merge into 1, and the merge keeps each passage and every note.

Removing a highlight stays in the reader, on purpose.

## The first line to draw

Most saves have a reason, and the reason is usually a sentence.

The article at the top of [the readlist](/queue?utm_source=blog-highlights-find-their-sentence-again&utm_medium=internal&utm_content=readlist) holds that sentence somewhere. Select it, press Highlight, and the quote stays the quote when the page behind it moves on.

An account without a single save yet gets its first one at [readplace.com](/?utm_source=blog-highlights-find-their-sentence-again&utm_medium=internal&utm_content=home), and the pen comes with it.
