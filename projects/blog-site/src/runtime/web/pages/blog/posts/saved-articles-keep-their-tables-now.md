---
title: "Saved Articles Keep Their Tables Now"
description: "A page built around one big table used to come back from a save as a run of plain text, every cell pressed against the next. The extractor was picking the table as the article and dropping the tags that made it one. The parser now puts the table back, and a replay over 5,088 stored articles showed the repair touches exactly the 59 damaged ones and nothing else."
slug: "saved-articles-keep-their-tables-now"
date: "2026-09-25"
author: "Fayner Brack"
keywords: "reader mode table broken, readability strips tables, save article with tables, read it later tables, html table missing in reader view, mozilla readability tables, saved article turned into plain text, pocket alternative, readplace"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Some pages are mostly one big table: a registry, a benchmark, a comparison. Saved to Readplace, a page like that could come back as plain text, every cell pressed against the next, while the save itself reported success. The extractor was choosing the table as the article and dropping the tags that made it one. A repair step now puts the table back on every new save, and a replay over the 5,088 stored articles showed it touches exactly the 59 damaged ones, changing their markup and not a word of their text.

</div>
</details>

59 of the 5,088 article bodies in Readplace's production store had lost their tables. None of those 59 saves had failed. Each one crawled, got its TL;DR, and sat in a readlist looking finished.

The clearest case was [IANA's media-types registry](/view/www.iana.org/assignments/media-types?utm_source=blog-saved-articles-keep-their-tables-now&utm_medium=internal&utm_content=read-www-iana-org), the reference page that lists which file types exist on the internet. That page is one table, about 1,800 rows of it. The stored copy held every row as bare text, one cell against the next, with nothing left to say where a name ended and its template began.

> **The text of every cell was still there. The tags that made them cells were gone.**

## Rows with no table around them

The stored bodies were not missing their rows. They held `<tr>` and `<td>` tags sitting outside any `<table>`, and an HTML parser meeting a stray table tag treats it as a mistake to recover from. It throws the tag away and keeps the text inside it.

So the reader showed the registry as one paragraph that scrolls for 1,800 rows. Nothing complained at save time, and nothing complained at read time, because dropping a stray tag is recovery, not an error.

## The extractor chose the table as the article

Readplace pulls the article out of a saved page with Readability 0.6.0, the extraction library behind Firefox's reader view. On an ordinary page it works by scoring: paragraphs earn points, navigation loses them, and the highest-scoring node becomes the article.

A page dominated by one data table flips that logic. The cells are the content, so the cells earn the points, and the winner is the table's own `<tbody>`, or the table itself. When [Readability](/view/github.com/mozilla/readability?utm_source=blog-saved-articles-keep-their-tables-now&utm_medium=internal&utm_content=read-github-com) then joins the winner with its siblings, it retags the winning node to a `<div>`. The rows come out the far side in order, orphaned, with no table above them.

No released version of Readability fixes the retag. Neither does its main branch, an open pull request, or a fork, so waiting on upstream was not a plan. The other damaged bodies in the store came from GitHub commit pages, Hacker News items, schema.org, gtfobins, and old-web essays on jwz.org and paulgraham.com that use a table for layout.

## The repair runs after the extractor

The fix does not patch Readability. A step called restoreRetaggedTables runs on its output, wired in as a required dependency of the parser: drop the call and the parser's own interface test fails.

The step looks for a container whose children are all table parts, rows or cells with no table above them. That container gets a fresh `<table>` written back inside it, plus a `<tr>` when the children are bare cells. A layout table that held a single cell is unwrapped instead, so an essay that lived inside one does not come back wearing a bordered box.

Anything else passes through untouched. The replay over all 5,088 stored bodies is what makes that claim checkable: it changed exactly the 59 broken ones, and their text and canonical content hash came out identical, so the words stayed put while the markup around them healed.

## Old saves catch up on their next parse

The repair sits in the save path, so it covers every save from this week on. A body already in the store stays as it is until its URL is parsed again, and at that point the stored copy comes out repaired.

Readability sets the other boundary. It still keeps only the part of the page it scored highest, so a header row it did not select stays dropped, and a second table beside the winner stays dropped with it. The registry comes back as the application/* section alone, rows and columns intact, headers gone.

## Reading a table as a table

Tables are where dense pages keep their substance: a benchmark, a comparison of libraries, a protocol registry, a changelog. A page you saved for its columns is worth little without the columns.

The registry that opened this post reads as rows again on a fresh save. A benchmark saved through [the browser extension](https://readplace.com/install) arrives with its columns now, and a link pasted at [readplace.com](/?utm_source=blog-saved-articles-keep-their-tables-now&utm_medium=internal&utm_content=home) goes through the same parser.
