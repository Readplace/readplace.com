---
title: "The Import Page That Told Search Engines to Skip It"
description: "Readplace's importer was built for readers leaving Pocket and Omnivore, then it carried a noindex tag that kept it out of search results and went unnamed to AI assistants. It reads index, follow now, describes itself with how-it-works, sources, and FAQ copy that doubles as WebPage and FAQPage structured data, sits in the sitemap, and points assistants at it through llms.txt. The page also opens on paste-a-link, and the old deep links still resolve."
slug: "import-page-search-engines-can-find"
date: "2026-07-07"
author: "Fayner Brack"
keywords: "import pocket to read it later, import bookmarks to read later app, where to import saved links, pocket alternative import, omnivore alternative import, read it later import from search, import reading list, bulk import links, findable import page, readplace import"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Search for somewhere to move a pile of saved links and, until this week, Readplace's import page could not turn up. The page carried a noindex tag, so search engines were told to pass it by, and the file that guides AI assistants did not name it. Both are fixed. The import page reads index, follow now, sits in the sitemap, and describes itself on the page with how-it-works steps, a list of what you can bring in, and an FAQ, all of it also written as WebPage and FAQPage structured data a search engine reads without rendering the page. The assistant discovery files, llms.txt and llms-full.txt, point at readplace.com/import as the self-serve path now, with the concierge email left as the fallback for anything too large. The page also opens on paste-a-link instead of the upload tab, and the old deep links still resolve.

</div>
</details>

Readplace built its import page for readers leaving a service that shut down. Then it put a line in the page that kept those readers from finding it.

The line was 2 words a search engine reads and obeys: noindex, nofollow. It tells a crawler not to list the page and not to follow its links. So the page meant to catch a person searching for a new home for their saved articles was the one page on the site search engines were told to pass by.

**A page marked do-not-index is invisible to the exact reader it was built for.**

## What the page tells a search engine now

The fix starts with those 2 words. The page reads index, follow, with a single canonical address at /import, so a crawler is free to list it and knows which address to rank.

That only helps if there is something on the page worth ranking. A search engine ranks words, and the old page was mostly a file picker and a tab. So the page carries text under the upload box now. There is a how-it-works list of 3 steps. There is a short section on what you can bring in, from a browser's bookmarks export to a Pocket file to a newsletter page full of links. And there is an FAQ that answers the questions people actually type: whether you need an account, what file formats work, whether there is a Pocket import.

The same words go out in a second shape. The FAQ is written into the page as [JSON-LD](/view/json-ld.org/), the format a search engine parses for the answers it shows above the blue links, and the page itself carries a WebPage record in the same format. The sitemap lists the page too, so a crawler is handed it rather than left to find it on its own.

## What it tells an AI assistant

Search engines are one way people look now. Asking an assistant is the other. A reader who used to type a question into Google types it into Claude or ChatGPT instead, and the assistant answers from whatever it can read about the product.

Readplace keeps 2 files for that, llms.txt and [llms-full.txt](/view/llmstxt.org/), a plain-text brief an assistant can pull to learn what the product does. [I have written before about assistants finding Readplace this way.](/blog/ai-agents-discover-readplace) Until this week both files pointed an assistant asked about moving a reading list at the concierge email, or a picker buried on the queue page. Neither said that a person could open readplace.com/import, paste a link or drop a file, and review the result with no account.

Both files name the page now. An assistant asked where to move a Pocket or Omnivore export can hand back the self-serve address, and keep the email as the fallback for a file over 5 MiB or a list past 2,000 links. The Pocket and Omnivore migration steps in the long file were rewritten the same way, the import page first and the email second.

## Paste a link comes first

One more thing moved. The page used to open on the upload tab, with paste-a-link behind it. Most people arriving from a search do not have an export file ready. They have a page full of links, a newsletter issue or a blogroll or a column of bookmarks, and the quickest thing they can do is paste its address.

So the tabs swapped. Paste a link is first and default, and uploading a file moved to /import?mode=upload. The old /import?mode=from-url links still land where they did before, so nothing that pointed at the earlier address broke.

## The reader who was already looking

None of this changes what the importer does once you are on it. The upload, the review, the ticking, and the account waiting until you commit are the same as [the day the importer went self-serve](/blog/import-links-before-signing-up). What changed is whether the reader looking for it can arrive.

A read-it-later tool keeps or loses a reader in the hour after their old one closes. Pocket shut on July 8, 2025. Omnivore shut in November 2024. In that hour a person has an export file or a page of links and a search box, and they type some version of where do I put these now. If the page built to answer that is marked do-not-index, and goes unnamed to the assistant they ask instead, the answer they get back is every other product's page.

> **The importer was already the easiest way in. The channels that send people to an import page just couldn't see it.**

The work here did not touch the import flow. It made the page findable by the 2 channels a person uses while they are deciding, the search engine and the assistant. That is the part of the funnel that sits before the product, and it was the part that was dark.

## Move a list you've been putting off

If a Pocket or Omnivore export has been sitting in a downloads folder, or your links are spread across one page you keep meaning to deal with, the import page takes either and shows you the URLs before you sign up. Open [readplace.com/import](/import) and paste or upload.

The next time someone asks you where to move a stack of saved links, that address is a page a search engine can rank and an assistant can quote, instead of one you had to already know was there.
