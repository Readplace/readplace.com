---
title: "An Import Page Has to Be Found to Work"
description: "Readplace's import page worked, and a noindex tag kept search engines and AI assistants from ever seeing it. It's indexable now, it answers the questions people ask before they start, and it opens on a paste box."
slug: "import-page-findable-in-search"
date: "2026-07-08"
author: "Fayner Brack"
keywords: "import pocket links, how to import reading list, import bookmarks to read it later, migrate off pocket, import links without an account, read it later import, import newsletter links, pocket export html, find the import page in search, ai assistant import reading list"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

The page that imports your old reading list used to carry a noindex tag, so search engines and AI assistants could not see it. It worked for anyone who reached it: upload a file or paste a link, review the addresses it finds, and sign in only at the end to save them. But the page told crawlers to skip it, so the person searching for a way off Pocket, or asking an assistant, did not land there. It returns index, follow now, with one canonical address and a spot in the sitemap. It also grew a short how-it-works, the file types it reads, and five plain questions with answers, written both as text you can read and as FAQPage structured data a search engine or an assistant can quote. The tabs flipped too, so the page opens on paste-a-link instead of file upload, because most people arriving cold have a link, not an export file.

</div>
</details>

Readplace's import page did its job. It also told search engines to skip it.

The page has been open to anyone, no login required. Upload a file or paste a link, and it reads out every web address inside and lays them in a checkable list. The account waits until the end, the moment you save the selection to your queue. [I moved the signup to the commit step for a reason](/blog/import-links-before-signing-up), and none of that reason survives if no reader can reach the page.

A reader leaves Pocket, or Omnivore, or whatever shut down this month, and goes looking for somewhere to put the list they kept. They open a search, or they ask an assistant where to move a reading list. The page built to catch them was carrying a `noindex, nofollow` tag, so neither one could see it.

That tag is a small instruction in the page's HTML. It tells a crawler not to add the page to its index and not to follow the links on it. For a private screen, that is the right setting. For the one page whose whole point is to be found by someone mid-move, it was the wrong one.

> **A page set to noindex can be built perfectly and still go unseen.**

## What the crawler was told to ignore

The fix flipped the instruction. The import page returns `index, follow` now, under one canonical address at `readplace.com/import`, and it sits in the sitemap next to the pages that were public from the start. A search engine can list it, so the query that should land there can.

Being listed is the floor. A blank page that ranks is still a blank page. So the import page grew the parts a first-time visitor wants before they hand it a file: a short how-it-works, the kinds of export it reads, and a handful of plain questions with answers.

## The questions people ask before they start

The questions are the ones a reader types, or puts to an assistant, right when they are about to move a list.

Do I need an account to import? No, not until you save the selection. What files work? Any text-shaped file, because it scans for `http` addresses and the format around them does not matter. Is there a Pocket import? Yes, the HTML file Pocket handed you on the way out. How many links at once? Up to 2,000, from a file up to 5 MiB, and anything larger goes to a slower path by email.

Those answers sit on the page as text a reader can see. They also sit in the markup as [FAQPage structured data](/view/schema.org/FAQPage), the format a search engine reads to show a question and its answer inside the results.

That second copy is the one that reaches an AI assistant. Ask Claude or ChatGPT how to move a Pocket export into a new reader, and the answer is built from pages the assistant can fetch and parse. A page marked noindex, with no structured answers on it, gives it little to work with. The same five questions, laid out where a machine can read them, give it a page to point at.

> **The answer a reader searches for and the answer an assistant repeats come off the same page.**

## Paste a link comes first now

One more thing moved. The import screen opened on the file-upload tab, with paste-a-link second. Most people arriving cold do not have an export file in hand. They have a link, a newsletter issue, a page of bookmarks. So paste-a-link is the first tab now, and the one the page loads on. Upload is still there, one click over at `/import?mode=upload`, and the old deep links still land where they used to.

The order matches the visitor. The fastest thing to try is the thing already in front of you when the page opens.

## A page that works is not the same as a page that's found

I built the import flow to be the easy way off a service that closed. Reachable logged out, the review before the commit, the account last. All of that held while the page sat behind a noindex tag, which meant the people it was built for could not find it in the place they went looking.

Findable is part of the feature, not a coat of paint on top of it. A page that answers the question only helps the reader who lands on it, and landing there starts with a search engine, or an assistant, being allowed to see the page at all.

A page that works is a fair goal. A page the right reader can find is the one that pays off.

If you are moving a reading list off something that shut down, the page is at [readplace.com/import](/import) now, paste box open. The [pre-signup writeup](/blog/import-links-before-signing-up) covers what carries across the account step, and the [Pocket guide](/blog/pocket-migration) covers that move on its own.
