---
title: "Pocket Shut Down in 2025. Here's How to Recover and Move Your Reading List."
description: "Pocket closed on July 8, 2025. If you missed the export, your articles are often still recoverable. Here's how to find them and move to Readplace."
slug: "pocket-migration"
date: "2026-05-06"
lastModified: "2026-07-26"
author: "Fayner Brack"
keywords: "Pocket migration, Pocket export, Pocket alternative, move from Pocket, Pocket shut down 2025, Pocket replacement"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Pocket shut down July 8, 2025. If you missed the export window, check your email for Pocket confirmation messages, browser history for getpocket.com URLs, the Wayback Machine, and linked services like IFTTT. If you have the HTML export file, sign in to Readplace, open your queue, and use the "Import from a file" picker. Pick the file, untick anything you don't want, then click Import. Files over 4.5 MB or above 2,000 links fall back to emailing readplace+migrate@readplace.com (24 to 48 hour concierge turnaround).

</div>
</details>

I went to getpocket.com in July 2025 to grab the export I had put off for years, and the site was already gone. Pocket had shut down on July 8. Mozilla acquired it back in 2017, slowed the work down over the years, and then pulled the plug. There had been a window to export before the servers went offline, and I had walked right past it.

So this is the story of getting that reading list back without the export tool, and what I learned moving it into Readplace.

## How Pocket got to the shutdown

Mozilla bought Pocket for an undisclosed amount in 2017. The team stayed small and the roadmap thinned out, and feature updates came less and less often.

By early 2025 Pocket was running in maintenance mode. Mozilla posted the shutdown notice in April 2025 and gave people until July 8 to export their data.

The export tool produced one HTML file with every saved URL and its title in it.

If you grabbed that file, you already have what you need and you can skip ahead. I did not grab it, and that is where the work started.

## Recovering a library with no export file

The Pocket servers were offline. But the articles I had saved over the years had left copies in a handful of other places, and that is what I went after, one source at a time.

I started with email.

Pocket used to send a confirmation message every time you saved something, at least to some accounts, so I searched my inbox for "Pocket" and "getpocket.com" and pulled the URLs out of those messages. That gave me a first batch of links.

Then I checked browser history. I had read a lot of saved articles through Pocket's web app, and those reader URLs were still sitting in Chrome's history.

A search for "getpocket.com/read" surfaced them. Most browsers keep about 90 days of history by default, and some keep more, so the older saves were thin here.

Next I tried the Wayback Machine. The Internet Archive had crawled plenty of Pocket profiles and public lists over the years.

I went to web.archive.org, searched for my old profile URL, and several cached snapshots came back with saved article links inside them.

Last I went through linked accounts. Years earlier I had wired Pocket up to IFTTT, and that recipe had logged each URL it saw. Zapier and Buffer do the same thing if you connected them.

> **No single source gave the whole library back. Each one returned a fragment, and the more places I checked, the more I got back.**

None of these methods rebuilt my full library on its own. Each one returned a piece of it.

Between the 4 of them I got most of what I cared about back, and the rest I let go.

## Importing into Readplace

Once I had a Pocket export file in hand, the rest was quick. I signed in, opened my [reading list](/queue), and found the "Import from a file" picker sitting next to the save bar. I chose the file, clicked Upload, and Readplace listed every URL it found. I unticked the few I no longer wanted, clicked "Import N selected", and the cards showed up in my queue right away. Titles and excerpts filled in over the next minute or two.

The importer pulls in every URL the file holds.

Tags, highlights, and read/unread state do not come across. Pocket's export format only carried URLs and titles, and the in-app importer reads any text-shaped file the same way, so there is nothing more to bring over.

One snag worth knowing about. If your file runs over 4.5 MB, holds more than 2,000 links, or the picker fails for any reason, send it to [readplace+migrate@readplace.com](mailto:readplace+migrate@readplace.com) and I import it by hand within 24 to 48 hours.

After the import I opened my [reading list](/queue) again and spot-checked a handful of entries to confirm the titles and URLs lined up. If something looks off, a follow-up to readplace+migrate@readplace.com will sort it.

If you came out of the recovery step with a pile of loose URLs and no export file at all, you can still rebuild by hand. Install the Readplace browser extension for [Chrome](/install?client=chrome) or [Firefox](/install?client=firefox) and save the recovered articles one at a time. It is slower, but it works.

## What you had in Pocket vs. what you get in Readplace

| Feature | Pocket | Readplace |
|---------|--------|-------|
| Save articles from browser | Yes | Yes (Chrome, Firefox) |
| Reader view | Yes | Yes |
| AI summaries | No | TL;DR for every article |
| Tags | Yes | Planned |
| Highlights | No | Planned |
| Full-text search | Yes (Premium) | Yes |
| Offline reading | Yes (mobile) | Planned |
| Mobile app | iOS, Android | iPhone and Mac (App Store), mobile web elsewhere |
| Data export | Yes (before shutdown) | Anytime, even after cancelling |
| Dark mode | Yes | Yes |

Readplace is smaller than Pocket was. It has no tags, and its app covers iPhone and Mac.

What it does have is an AI-generated TL;DR for every saved article, which Pocket did not offer. If you want to see how the current options stack up against each other, I wrote up the [best read-it-later apps in 2026](/blog/best-read-it-later-apps-2026).

## AI summaries for imported articles

Once your articles land, Readplace writes a short AI summary for each one. The summaries show up as each article finishes processing.

There is nothing for you to do here.

The work runs in the background and wraps up within a few hours for most libraries.

## Common questions

**Can I still export from Pocket?**

No. The servers went offline on July 8, 2025, and the export tool went with them.

If you downloaded the HTML export file before the shutdown, it still works fine. If you did not, the recovery steps above are your best shot.

**How do I import Pocket articles into another app?**

Most read-it-later apps take the HTML export file that Pocket handed out. Readwise Reader, Instapaper, and Raindrop.io all read it, and so does Readplace. Open your queue, upload the file with the "Import from a file" picker, and confirm the link list. For files over 4.5 MB or imports above the 2,000-URL cap, email readplace+migrate@readplace.com and the import gets handled for you within 24 to 48 hours.

**I lost my Omnivore reading list too. Can Readplace help?**

Yes. Omnivore shut down in November 2024. If you still have an Omnivore data export, send it to the same address. For the longer version of what happened there, see [Omnivore shut down: here's a read-it-later app that won't](/blog/omnivore-alternative).

The lesson I took from this is small and a little embarrassing. Export your data the day a service announces it is closing, and keep that file somewhere you control, because the recovery dance afterward only ever returns part of what you had.
