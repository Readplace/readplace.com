---
title: "Tables Survive the Save Now"
description: "A page built around one big data table, a standards registry, a command index, a type listing, used to come back from a save as an unbroken run of words, often with no summary above it. The library that extracts the article was renaming the table out from under its own rows. Readplace now rebuilds the markup on the way to storage, and the summariser writes a TL;DR for listing pages instead of refusing them. Across 5,088 stored articles, 59 carried the damage."
slug: "tables-survive-the-save-now"
date: "2026-09-26"
author: "Fayner Brack"
keywords: "save article with tables, reader mode breaks tables, readability table bug, read it later tables, save reference tables, orphaned table rows, table markup stripped, save a registry page, read it later for developers, readplace"
tags: ["changelog"]
banner: "Saved tables no longer collapse into a wall of text"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Pages built around one big data table, a standards registry, a command index, a type listing, used to come back from a save as an unbroken run of words, often with no summary above them. Readplace now rebuilds the table markup its extraction library strips, and its summariser writes a TL;DR for a listing page instead of refusing it. Across 5,088 stored articles, 59 carried the damage. A fresh save keeps its rows.

</div>
</details>

Hand a browser a `<td>` with no `<table>` around it and the tag gets dropped while the text inside survives. That parser rule stood between a saved copy of [IANA's registry of media types](/view/www.iana.org/assignments/media-types/media-types.xhtml?utm_source=blog-tables-survive-the-save-now&utm_medium=internal&utm_content=read-www-iana-org) and anyone opening it in the reader. The stored copy held 1,800 bare rows with no table left around them, so the reader ran every cell together into one unbroken block of text.

## Where the table went

The crawl runs each page through [Readability](/view/github.com/mozilla/readability?utm_source=blog-tables-survive-the-save-now&utm_medium=internal&utm_content=read-github-com), the extraction library behind most reader modes, to cut the article out of the page around it. Readability 0.6.0 scores table cells as content, so on a page that is mostly one data table, the winning node is the table's own body element. That is what it keeps as the article. Then, while stitching the winner together with its neighbours, it renames that element to a plain `div`.

The rows did not move. The table around them was renamed out of existence, and a `<tr>` without a `<table>` is exactly the markup the parser rule above throws away.

## 59 stored articles had the same hole

A sweep across all 5,088 stored article bodies found 59 carrying orphaned table parts. The list reads like a developer's browsing history: GitHub commit pages, GTFOBins entries, schema.org type definitions, Hacker News items, jwz.org, paulgraham.com.

No Readability release repairs the retag. Neither does its main branch, an open pull request, or a fork. A reader mode built on the library inherits the same flattening until it patches around it.

## A repair on the library's output

The fix runs on Readability's output rather than inside it. A container holding nothing but table parts gets its `<table>` rebuilt around them, and bare cells get a `<tr>` as well. A container that turns out to be the single cell of a page-layout table is unwrapped instead, so an essay a site had centred inside one giant cell does not come back wearing a bordered box.

Anything else passes through untouched. Replayed over all 5,088 stored bodies, the repair changed exactly the 59 broken ones and left every character of their text identical.

## The summary refused the same pages

A flattened registry had a second failure stacked on top. The model that writes each article's TL;DR is allowed to refuse a page with nothing to summarise, and a page that is one long table offers it almost no prose. On the stored IANA registry it refused 10 runs in 20, so half the time the article sat with no summary at all. Wikipedia's front page, a listing by design, was refused 9 times in 120 runs.

Its instructions now say what a listing page is and ask for a summary of what the page lists. The same stored inputs, replayed: 0 refusals in 20 on the registry, 0 in 120 on the front page. A page that has earned the refusal still gets it. A body that is 92% CSS and a hex dump both kept their refusals in the replay, which is the right answer for both.

## An old save catches up at its next crawl

A page saved from now on stores its table whole. An article already sitting in your readlist keeps its stored copy until the next crawl of that URL, and the repair applies then.

One limit is worth stating plainly. Readability picks a single winning region of a page, and on the IANA page that winner is the application/* registry alone, so the header row and the sibling registries beside it still don't make the cut. What changed is that the rows it does keep line up under their columns again.

Reference pages are the saves that get reopened, one lookup at a time, and they earn that reopening as tables rather than as word soup. The next one kept through [the browser extension](https://readplace.com/install) or pasted at [readplace.com](/?utm_source=blog-tables-survive-the-save-now&utm_medium=internal&utm_content=home) comes back holding its rows the way the site laid them out.
