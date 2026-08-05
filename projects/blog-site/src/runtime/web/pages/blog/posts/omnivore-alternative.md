---
title: "Omnivore Shut Down. Here's a Read-It-Later App That Won't."
description: "Omnivore shut down with two weeks notice. Readplace is a privacy-first read-it-later app built by a developer and no VC funding."
slug: "omnivore-alternative"
date: "2026-05-06"
lastModified: "2026-07-26"
author: "Fayner Brack"
keywords: "Omnivore alternative, Omnivore replacement, Omnivore shut down, read it later app, ElevenLabs Omnivore, Readwise Reader alternative, Pocket alternative"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Omnivore shut down two weeks after ElevenLabs acquired it. The cause was venture capital that needed an exit. Readplace is self-funded at $49/year, so subscriptions pay for servers and no investors are waiting on a sale. It ships Firefox and Chrome extensions, reader view, AI TL;DR summaries, full data export, and source-available code. It runs in Sydney under Australian privacy law.

</div>
</details>

On November 1, 2024, ElevenLabs acquired Omnivore. Two weeks later, on November 15, the service shut down and data deletion began. If you had years of saved articles, highlights, and notes in there, you had 14 days to get them out before they were gone.

Two weeks was the entire gap between "your app still works fine" and "your data no longer exists."

I want to walk through what actually happened, because the failure was not a bug in the code. Omnivore was open source, it was loved, and it had a clear mission with a real team behind it, and none of that survived the day the acquisition closed. The repository went read-only, the API stopped answering requests, and the newsletters stopped arriving in inboxes.

## The business model is what broke

Nothing about Omnivore's intentions was wrong. The team built a product people relied on every day, and then it vanished anyway, which tells you the problem lived one layer up from the product. A venture-backed app has to produce an exit for the people who funded it. When the exit shows up, the users who were the whole point a month earlier turn into an afterthought.

Plenty of Omnivore users landed on [Readwise Reader](https://readwise.io/read) at $119.88/year, while others went self-hosted with Karakeep or Wallabag. Each path costs you something. Readwise has the most features but the highest price, and the self-hosted tools are free right up until you remember that you are now the one running a server and applying the updates when they break.

I built Readplace to sit between those two. It is hosted, so you do not run anything, and the money comes from one place only: subscriptions pay for the servers and the work, and there is no investor in the background waiting for a sale. If you want the side-by-side on every option, I wrote up the [best read-it-later apps in 2026](/blog/best-read-it-later-apps-2026).

## Built by one developer who actually reads

I ran a personal reading pipeline for myself for 10 years before any of this became a product, watching the apps I leaned on disappear one after another. Pocket got abandoned. Omnivore got bought and shut down. So I took the system I had already been depending on for a decade and turned it into something other people could use too, run by one developer building in the open and shipping one feature at a time.

## What works today

Here is what is shipped and running right now:

- **Firefox and Chrome extensions.** Save any page with one click or a keyboard shortcut, and every open tab at once from the right-click menu.
- **Reader view.** A clean article layout built on Mozilla's readability engine, with the clutter stripped out.
- **TL;DR summaries.** An AI-generated summary on every article, so you can read the key points in seconds. It is in every plan.
- **Web app.** Manage your reading list from any browser, with no app store in the way.
- **Auto dark mode.** It follows your system preference.
- **Secure auth.** OAuth with PKCE, and tokens stay in your own browser.
- **Full data export.** Pull your saved articles out whenever you want, including after you cancel.
- **Privacy first.** Hosted in Sydney under the Australian Privacy Act, with no third-party tracking scripts and no ads.

## What Omnivore had, and where Readplace stands

Omnivore had years of head start. Readplace is younger, and I would rather show you the gaps than talk around them.

| Feature | Omnivore | Readplace | Status |
| --- | --- | --- | --- |
| Browser extension | Yes | Yes | Shipped |
| Reader view | Yes | Yes | Shipped |
| TL;DR summaries | No | Yes | Shipped |
| Dark mode | Yes | Yes | Shipped |
| Full data export | Yes | Yes | Shipped |
| Open source | Was (archived) | Source-available | Shipped |
| Highlights and notes | Yes | No | Planned |
| Full-text search | Yes | No | Planned |
| Newsletter inbox | Yes | No | Planned as Gmail import |
| Labels / tags | Yes | No | Planned |
| Native mobile apps | Yes | iPhone and Mac | Shipped for iPhone and Mac, Android planned |
| RSS feed reader | Yes | No | Not planned yet |
| API access | Yes | OAuth only | Extension API exists but not yet for public consumption |

> **I would rather be honest about the gaps than pretend they aren't there.**

Features land one at a time, and the [roadmap is public](https://readplace.com/#roadmap) so you can see what is next.

## Your data, on your terms

**Source-available.** The full source is [on GitHub](https://github.com/Readplace/readplace.com). If Readplace went away tomorrow, anyone could stand it back up, and that is the whole point of putting it there.

**Full export, whenever you want.** You can export all of your data even after you cancel. The export is a core promise, not a perk, so your saved articles stay reachable no matter what your subscription is doing.

**Australian hosting.** It runs in Sydney, under the Australian Privacy Act, outside US jurisdiction, with no third-party tracking scripts, no ads, and no data sales.

**No venture capital.** Readplace is self-funded and the revenue comes from subscriptions, which means there is no board counting on an exit and no acquisition for me to go chase at your expense.

## Pricing

It is $49/year, and the TL;DR summaries are part of that.

Readwise Reader is a strong pick for power users at $119.88/year. Readplace is the simpler and cheaper option, and it stays pointed at saving and reading articles rather than growing into a full research platform.

[Sign up here](https://readplace.com/signup).

## Common questions from Omnivore users

**What happened to Omnivore?**

ElevenLabs acquired it on November 1, 2024 and shut it down on November 15, which left users roughly two weeks to export their data before deletion started. The open-source repository was archived.

The team went to ElevenLabs to work on text-to-speech rather than reading tools, so Omnivore is not coming back.

**Is there a free Omnivore alternative?**

Readplace costs $49/year. The self-hosted options like Karakeep and Wallabag are free, but you run your own server to use them. Readwise Reader is the most feature-complete of the bunch at $119.88/year.

**Can I import my Omnivore data into Readplace?**

Send your Omnivore data file to readplace+migrate@readplace.com and I will do the import for you, so if you exported your data before the shutdown, hold onto that file. You can also start fresh right now with the [browser extension](https://readplace.com/install) and save any article with one click.

## Your reading list should not come with an expiry date

The Omnivore shutdown taught me something I already half-knew: a read-it-later app is only as durable as the reason it exists, and "return capital to investors" is not a reason that protects your saved articles. Install the extension, save one article, and see whether it fits how you read.

[Install the browser extension](https://readplace.com/install) or [view the source on GitHub](https://github.com/Readplace/readplace.com).
