---
title: "Highlights and notes that stay on their passage when the article changes"
description: "Select text in the reader to highlight it or add a note, on the web and in the iPhone app. A highlight is stored as its quote and the words around it, so a recrawled article moves it only when the passage moved and lists it as not found when the passage is gone. Highlights also appear in the markdown copy, the EPUB download, the account export and 2 MCP tools."
tldr: "Highlight and Add note, both marked Beta, appear when text is selected in the reader on the web and in the iPhone app. Readplace stores a highlight as its quote with 32 characters of text on each side rather than as a position, so when an article's shared body is fetched again it moves a highlight only when the passage moved, and it lists one it cannot find as \"Not found in this version\" instead of guessing. Highlights show in a rail beside the article, in the markdown copy, in the EPUB download and in the account export, and a connected assistant gets list_highlights and create_highlight."
excerpt: "Highlights and notes in the reader, kept on their passage when the article is fetched again."
slug: "highlights-and-notes-stay-on-their-passage"
date: "2026-11-09"
author: "Fayner Brack"
keywords: "highlights, notes, annotations, reader, recrawl, re-anchoring, markdown, EPUB, account export, MCP tools"
tags: ["changelog"]
banner: "Highlight a passage and it stays put when the article changes"
---

Highlights and notes are in the reader for every signed-in Readplace account, on the web and in the iPhone app. Selecting a passage brings up a bar with 2 buttons, Highlight and Add note, and both carry a Beta label.

## Select a passage, then Highlight or Add note

Open an article from [the readlist](/queue?utm_source=blog-highlights-and-notes-stay-on-their-passage&utm_medium=internal&utm_content=readlist) and select the words to keep. The bar appears under the selection.

Highlight marks the passage in 1 colour and adds it to a Highlights rail beside the article. Add note opens a note field first and saves the highlight and its note in 1 step.

Each row in the rail shows the quote, its note when it has one, a Jump link to the passage and a Delete button. A note can be added, edited or cleared later from its row.

A new selection that overlaps or touches an existing highlight merges into it, and the notes are joined. Quotes and notes are each capped at 8,191 characters.

Creating a highlight has the same gate as saving a link: a signed-in account with write access. A public `/view` page has no highlighting, since no account owns a mark there.

## On a phone and inside the iPhone app

On a phone, a long press and the native handles select the passage as on any other page. A single tap on a sentence selects that sentence, so a highlight of 1 sentence needs no handles at all. The bar sits below the selection, clear of the system's copy menu.

The iPhone app opens the same reader page, so the bar, the rail and the note dialog work there without an app update.

## What a recrawl does to a highlight

An article's body in Readplace is shared by every reader who saves that URL, and it is fetched again when a recrawl or a refresh brings in a new copy. A position in the old copy points nowhere useful in the new one.

So a highlight is stored as text rather than as a position: the exact words selected, with 32 characters of the surrounding article on each side. That is the shape of the text quote selector in the [W3C Web Annotation model](/view/www.w3.org/TR/annotation-model/?utm_source=blog-highlights-and-notes-stay-on-their-passage&utm_medium=internal&utm_content=read-w3c-annotation-model).

When the body changes, Readplace looks for each highlight of that URL in the new text. It tries the exact words first. When they are gone, it allows differences of up to 20% of the quote's length, to a maximum of 256 characters. It accepts a match only at a similarity of 0.8 or more to the quote and 0.5 or more to the text around it, and only with a margin of 0.05 over the next best candidate.

A highlight that passes is drawn at its new place. A highlight that fails is kept, with its quote and its note, and the rail lists it under "Not found in this version". It is not moved to a weaker match and it is not deleted. The next change to the body tries again.

Measured on 7 November 2026 on staging: 185 highlights over 37 recrawl pairs, 5 per pair, from 18 articles with 2 or more dated versions. 54 (29%) stayed in place. 111 (60%) moved, and 107 of those were the exact quote at a new offset. 20 (11%) were not found, and all 20 came from 1 web.archive.org page whose versions alternate between 2 different pages. Of the other 165, 0 were lost.

## Where highlights show up

The rail beside the article is the first place, and it is the only one with Jump and Delete.

The markdown copy of an article, which a connected client reads from the reader's own URL as `text/markdown`, ends with a `## Highlights` section when the article has any. Each quote is a blockquote, with its note under it.

The EPUB downloaded from the reader marks each highlighted passage in the text and ends with the same list. It is the same [EPUB download](/blog/read-your-saved-articles-on-a-kindle-or-kobo?utm_source=blog-highlights-and-notes-stay-on-their-passage&utm_medium=internal&utm_content=post-read-your-saved-articles-on-a-kindle-or-kobo) that goes to a Kindle or a Kobo, now with the marks in it.

The [account export](/export?utm_source=blog-highlights-and-notes-stay-on-their-passage&utm_medium=internal&utm_content=export) lists each article's highlights and notes, with the passage and the note. Highlights and notes are deleted with the article, and with the account.

## list_highlights and create_highlight for a connected assistant

An assistant connected through [the MCP server](/mcp?utm_source=blog-highlights-and-notes-stay-on-their-passage&utm_medium=internal&utm_content=mcp) has 2 more tools.

`list_highlights` returns the highlights and notes in 1 saved article, in reading order. A highlight whose passage is gone from the current version is listed as not found.

`create_highlight` highlights a passage the assistant quotes exactly as `get_article_content` returned it, with an optional note. A quote that is not in the article is refused and nothing is saved. The tool answers "That quote is not in the article's current text. Copy it exactly from get_article_content." A quote that appears more than once is refused too, until the call carries `text_before` with the words just before the passage meant. A quote that overlaps an existing highlight merges into it, as a selection in the reader does.

Creating is gated like saving, and listing is not. Editing and deleting a highlight stay in the reader. The Claude connector lists both tools now. The [ChatGPT connection](/blog/connect-chatgpt-in-one-click?utm_source=blog-highlights-and-notes-stay-on-their-passage&utm_medium=internal&utm_content=post-connect-chatgpt-in-one-click) gets them after OpenAI next scans the tool list, because ChatGPT runs the tools from its last scan.

## Outside this release

Highlights come in 1 colour, and each carries 1 note or none. There are no tags and no second colour.

Nothing syncs out to Obsidian, Notion or Logseq, which is the row where [Readwise Reader is ahead](/blog/readplace-vs-readwise-reader?utm_source=blog-highlights-and-notes-stay-on-their-passage&utm_medium=internal&utm_content=post-readplace-vs-readwise-reader). There is no keyboard shortcut for highlighting.

Both buttons carry the Beta label. A page where the bar does not appear, or a highlight that lands in the wrong place, goes to [readplace@readplace.com](mailto:readplace@readplace.com).
