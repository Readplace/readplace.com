---
title: "A Deleted Page Now Gets a Straight Answer"
description: "Save a link whose page the site later deleted and Readplace used to blame a bot wall, then pitch the browser extension as the fix. A deleted page now gets a straight answer: the notice says the page is gone, your link stays saved, and the capture offer appears only on failures a capture can still rescue."
slug: "a-deleted-page-gets-a-straight-answer"
date: "2026-08-18"
author: "Fayner Brack"
keywords: "saved article 404 page not found, link rot read it later, deleted page saved link, http 410 gone vs 404, dead links in reading list, pocket import link rot, read it later error messages, why a saved article failed, save articles before they disappear, pocket alternative"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Save a link to a page its site has since deleted, and the explanation under it used to blame a bot wall and pitch the browser extension as the cure. Readplace now tells that page's story straight: when a site answers 404 or 410, the notice says the page no longer exists at that address, your link and its place in the readlist stay saved, and the capture offer is left out, because a browser capture cannot reach a page that isn't there. The bot-wall explanation and the capture path stay on the failures they're true for, where opening the page in your own browser still rescues the save. 22 of last week's failed crawls ended at a 404, so the wrong advice was showing more often than a corner case would.

</div>
</details>

Sites delete pages and leave the addresses behind. Follow one of those addresses today and the answer is a [404](/view/developer.mozilla.org/en-US/docs/Web/HTTP/Status/404), or a [410](/view/developer.mozilla.org/en-US/docs/Web/HTTP/Status/410) from a site tidy enough to admit the page is gone for good. 22 of the crawls that failed in Readplace last week ended at a 404.

The trouble was the story the reader told about them.

## An explanation written for a different failure

A saved link whose page has died still keeps its card. Open it, and the reader leads with "Your link is saved", which stays true whatever the crawl found: the URL, the title, and the card's place in your readlist survive. Under that title sat the explanation, and until this week a deleted page got this one:

"We couldn't pull the article text. The site may be blocking automated fetches. Save it with the browser extension and iPhone app instead."

That copy was written for a bot wall, and for a bot wall it's fair. A blocked page still exists. The block aims at datacenter addresses rather than at people, so an ordinary browser on a home connection still gets the real article, and a capture taken there rescues the save.

A deleted page fails differently. Nothing was blocking automated fetches, the site answered plainly, and the page is as missing for a browser as it is for a crawler. The extension that line asks for would capture the site's error page, whatever design the site hangs on its 404s, and file it as your article.

Follow the old advice to the letter and the cost is concrete: install an extension, sign back in, reopen a dead link, and save a copy of a page whose whole content is that there is no page.

## Gone now has its own words

A crawl that ends at a 404 or a 410 now lands on its own explanation, and it reports instead of accusing:

"The site says this page no longer exists at this address, so there is no article text to pull in."

One control remains on the notice, the link out to the original address. The site's own answer is one click away, in case the page moved and a redirect or a search on that site can still find it.

What the notice no longer carries is the install pitch.

> **A capture from your own browser rescues a blocked page and does nothing for a deleted one.**

## Where the capture pitch still stands

The bot-wall explanation didn't disappear. It moved to the failures it's true for.

When a site's edge refuses Readplace's servers, the notice still says so and still offers the way through: open the page in your browser and let [the browser extension](https://readplace.com/install) or the iPhone app capture the full page from your side of the wall. That path recovers saves every week, because on those failures the page is up and a home connection is welcome where a datacenter isn't.

The change is that the offer now appears only where it can deliver. A pitch that turns up on failures it can't fix trains a reader to skip it on the failures it can.

## The links that were already gone

A link saved from this morning's newsletter rarely dies before the crawl reaches it. The 404s pool in older addresses: a bookmark that rode in with [a Pocket export](/blog/pocket-migration), or a reference at the bottom of a piece filed 2 years ago and finally opened this week.

Readplace can't bring back what a site deleted before the save existed. What it does now is say so in the notice, and keep [the clean copy](/blog/read-any-article-clean-reader) of every page the crawl reached while that page was still standing.

Both kinds of link sit in the readlist at [readplace.com](/) today. They just stopped sharing an explanation.
