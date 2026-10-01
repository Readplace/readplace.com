---
title: "Omnivore Alternative: A Read-It-Later App With No Investors"
description: "Why Omnivore shut down 2 weeks after its team joined ElevenLabs, and a table of what Readplace matches and still lacks, like highlights and full-text search."
slug: "omnivore-alternative"
date: "2026-05-06"
lastModified: "2026-10-01"
author: "Fayner Brack"
keywords: "Omnivore alternative, Omnivore replacement, Omnivore shut down, read it later app, ElevenLabs Omnivore, Readwise Reader alternative, Pocket alternative"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Omnivore shut down 2 weeks after its team joined ElevenLabs. The cause was venture capital that needed an exit. Readplace is self-funded through subscriptions, with no investors. It ships Firefox and Chrome extensions, reader view, AI TL;DR summaries, a JSON export of every saved article, and source-available code. It runs in Sydney under Australian privacy law.

</div>
</details>

On October 29, 2024, Omnivore announced its team was joining ElevenLabs. About 2 weeks later, on November 15, the service shut down and data deletion began. If you had years of saved articles, highlights, and notes in there, you had 17 days to get them out before they were gone.

Two weeks was the entire gap between "your app still works fine" and "your data no longer exists."

I want to walk through what actually happened, because the failure was not a bug in the code. Omnivore was open source, it was loved, and it had a clear mission with a real team behind it, and none of that survived the team's move to ElevenLabs. The hosted service stopped, the API stopped answering requests, and the newsletters stopped arriving in inboxes.

## The business model is what broke

Nothing about Omnivore's intentions was wrong. The team built a product people relied on every day, and then it vanished anyway, which tells you the problem lived one layer up from the product. A venture-backed app has to produce an exit for the people who funded it. When the exit shows up, the users who were the whole point a month earlier turn into an afterthought.

Plenty of Omnivore users landed on [Readwise Reader](https://readwise.io/read) at $119.88/year, while others went [self-hosted with Karakeep](/blog/readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later?utm_source=blog-omnivore-alternative&utm_medium=internal&utm_content=post-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later) or Wallabag. Each path costs you something. Readwise has the most features but the highest price, and the self-hosted tools are free right up until you are the one running a server and applying the updates when they break.

I built Readplace to sit between those two. It is hosted, so you do not run anything, and it is funded by subscriptions, with no investor in the background. If you want the side-by-side on every option, I wrote up the [best read-it-later apps in 2026](/blog/best-read-it-later-apps-2026?utm_source=blog-omnivore-alternative&utm_medium=internal&utm_content=post-best-read-it-later-apps-2026).

## Built from a 10-year reading pipeline

I ran a personal reading pipeline for myself for 10 years before any of this became a product, watching the apps I leaned on disappear one after another. Pocket got abandoned. Omnivore's team left for ElevenLabs and the app shut down. So I took the system I had already been depending on for a decade and turned it into something other people could use too, built in the open and shipping one feature at a time.

## What works today

Here is what is shipped and running right now:

- **Firefox and Chrome extensions.** Save any page with one click or a keyboard shortcut, and every open tab at once from the right-click menu.
- **Reader view.** A clean article layout built on Mozilla's readability engine, with the clutter stripped out.
- **TL;DR summaries.** An AI-generated summary on every article, so you can read the key points in seconds. It is in every plan.
- **Web app.** Manage your reading list from any browser, with no app store in the way.
- **Auto dark mode.** It follows your system preference.
- **Secure auth.** OAuth with PKCE, and tokens stay in your own browser.
- **Data export.** Download a JSON list of every saved article whenever you want, including after you cancel. It carries each article's URL, title, site, excerpt, read status and dates, not the article text.
- **Privacy first.** Hosted in Sydney under the Australian Privacy Act, with no third-party tracking scripts and no ads.

## What Omnivore had, and where Readplace stands

Omnivore had years of head start. Readplace is younger, and I would rather show you the gaps than talk around them.

| Feature | Omnivore | Readplace | Status |
| --- | --- | --- | --- |
| Browser extension | Yes | Yes | Shipped |
| Reader view | Yes | Yes | Shipped |
| TL;DR summaries | In a daily AI digest, not per article | Yes | Shipped |
| Dark mode | Yes | Yes | Shipped |
| Data export | Yes | JSON list, no article text | Shipped |
| Open source | Yes (AGPL-3.0, repository still public) | Source-available | Shipped |
| Highlights and notes | Yes | No | Not built |
| Full-text search | Yes | No | Planned |
| Newsletter inbox | Yes | Forwarding address per newsletter | Shipped |
| Labels / tags | Yes | Readlists, up to 7 | Shipped as readlists, no tags |
| PDFs | Yes | Yes, scans read by OCR | Shipped |
| Native mobile apps | Yes | iPhone and Mac | Shipped for iPhone and Mac, Android planned |
| RSS feed reader | Yes | No | Not planned yet |
| API access | Yes | MCP server with 12 tools | Shipped |

The table shows what exists today. Rows marked Not built are gaps.

## Your data, on your terms

**Source-available.** The full source is [on GitHub](https://github.com/Readplace/readplace.com). The code is there to read. No licence grants the right to reuse it or run it yourself.

**Export, whenever you want.** You can export a JSON list of every saved article even after you cancel. It carries each article's URL, title and reading history, not the article text. The export is a core promise, not a perk, so your saved articles stay reachable no matter what your subscription is doing.

**Australian hosting.** It runs in Sydney, under the Australian Privacy Act, with no third-party tracking scripts, no ads, and no data sales. Readplace sends article text to DeepSeek to clean up the text and write the summary.

**No venture capital.** Readplace is self-funded and the revenue comes from subscriptions, which means there is no board counting on an exit and no acquisition for me to go chase at your expense.

[What happens to a library when a subscription ends](/read-it-later-that-wont-die?utm_source=blog-omnivore-alternative&utm_medium=internal&utm_content=read-it-later-that-wont-die) is spelled out on its own page.

## Pricing

The current plans are in the [pricing section of the home page](/?utm_source=blog-omnivore-alternative&utm_medium=internal&utm_content=pricing#pricing), and the TL;DR summaries are part of every plan.

Readwise Reader is a strong pick for power users at $119.88/year. Readplace is the simpler and cheaper option, and it stays pointed at saving and reading articles rather than growing into a full research platform.

[Sign up here](https://readplace.com/signup).

## Common questions from Omnivore users

**What happened to Omnivore?**

On October 29, 2024, Omnivore announced its team was joining ElevenLabs, and the service shut down on November 15, which left users about 2 weeks to export their data before deletion started. Its AGPL-3.0 source is still on GitHub, but the hosted service is gone.

The team went to ElevenLabs to work on text-to-speech rather than reading tools, so Omnivore is not coming back.

**Is there a free Omnivore alternative?**

Readplace is paid, with its current plans on the [home page](/?utm_source=blog-omnivore-alternative&utm_medium=internal&utm_content=pricing#pricing). The self-hosted options like Karakeep and Wallabag are free, but you run your own server to use them. Readwise Reader is the most feature-complete of the bunch at $119.88/year. [Free read-it-later apps in 2026](/blog/free-read-it-later-apps-2026?utm_source=blog-omnivore-alternative&utm_medium=internal&utm_content=post-free-read-it-later-apps-2026) breaks down what each free option costs in money and time.

**Can I import my Omnivore data into Readplace?**

If you exported your data before the shutdown, hold onto that file and [import it yourself](https://readplace.com/import) — the import page works logged out. You can also start fresh right now with the [browser extension](https://readplace.com/install) and save any article with one click.

## Readplace for specific jobs

- [Saving PDFs, scans included](/pdf-ocr?utm_source=blog-omnivore-alternative&utm_medium=internal&utm_content=pdf-ocr): how scanned pages are read and checked.
- [Moving from Pocket](/pocket-alternative?utm_source=blog-omnivore-alternative&utm_medium=internal&utm_content=pocket-alternative): what a Pocket export brings across before you make an account.
- [Reading from an AI assistant](/ai-reading-list?utm_source=blog-omnivore-alternative&utm_medium=internal&utm_content=ai-reading-list): saving to a readlist from ChatGPT, Claude or Gemini.
- [When a subscription ends](/read-it-later-that-wont-die?utm_source=blog-omnivore-alternative&utm_medium=internal&utm_content=read-it-later-that-wont-die): what stays readable if you stop paying.
- [Reading a PDF on a phone](/pdf-reflow?utm_source=blog-omnivore-alternative&utm_medium=internal&utm_content=pdf-reflow): a pasted PDF as text that fits the screen.
- [Turning an article into an EPUB](/article-to-epub?utm_source=blog-omnivore-alternative&utm_medium=internal&utm_content=article-to-epub): a file for a Kobo or Kindle, with no account.
- [Saving newsletter links](/save-newsletter-links?utm_source=blog-omnivore-alternative&utm_medium=internal&utm_content=save-newsletter-links): an address per newsletter, and only the articles are kept.
- [Compared with Readwise Reader](/readwise-reader-alternative?utm_source=blog-omnivore-alternative&utm_medium=internal&utm_content=readwise-reader-alternative): the gaps in one table.

## Your reading list should not come with an expiry date

The Omnivore shutdown taught me something I already half-knew: a read-it-later app is only as durable as the reason it exists, and "return capital to investors" is not a reason that protects your saved articles. Install the extension, save one article, and see whether it fits how you read.

[Install the browser extension](https://readplace.com/install) or [view the source on GitHub](https://github.com/Readplace/readplace.com).
