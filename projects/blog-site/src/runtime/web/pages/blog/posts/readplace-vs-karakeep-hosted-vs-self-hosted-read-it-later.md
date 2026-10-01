---
title: "Karakeep vs Readeck, wallabag and Hosted Readplace"
description: "Karakeep (formerly Hoarder), Readeck and wallabag compared as self-hosted read-it-later apps on install, AI and search, then Karakeep vs hosted Readplace."
slug: "readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later"
date: "2026-05-06"
lastModified: "2026-10-01"
author: "Fayner Brack"
keywords: "karakeep, hoarder, readplace, read it later, self-hosted, pocket alternative, readeck, wallabag"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Karakeep is free, open-source, and self-hosted with Docker. You get full data control and AI auto-tagging via Ollama, but you handle updates, backups, and uptime. Readeck and wallabag are 2 more open-source, self-hosted options, compared with Karakeep in their own table. Readplace is a paid hosted service with AI summaries included and no setup. You trade self-hosted control for convenience. Pick Karakeep if you already run a homelab. Pick Readplace if you would rather not maintain infrastructure for your reading list.

</div>
</details>

Pocket shut down in July 2025, and Omnivore shut down 2 weeks after its team joined ElevenLabs, so the developers who depended on those tools are now shopping for a read-it-later app they actually control. Two names keep coming up: **Karakeep** (formerly Hoarder) and **Readplace**.

Both target developers who read a lot, both have AI features, and both care about data ownership. Where they part ways is how the software reaches you, and who is on the hook for keeping it running when something breaks.

This post compares the two along that axis, so you can pick the tool that fits how you work. A later section sets Karakeep beside Readeck and wallabag, 2 more open-source, self-hosted apps.

## What each tool is

**Karakeep** is free, open-source, and self-hosted. You run it yourself with Docker. It does AI-powered auto-tagging through Ollama (local) or OpenAI, and it ships full-text search, browser extensions, and mobile apps for iOS and Android. It started as Hoarder, rebranded to Karakeep, and has about 29,000 GitHub stars as of September 2026, with active development.

**Readplace** is hosted, with its current plans on the [home page](/?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=pricing#pricing). You sign up, install the browser extension, and start saving articles. It includes AI-generated TL;DR summaries, a clean reader view, and Pocket import, and you skip Docker, server setup, and ongoing maintenance entirely. It grew out of a personal reading system that ran for 10 years.

## The real comparison: deployment model

The feature lists overlap enough that comparing them line by line tells you little, because both tools save articles and tag or summarise them with a model. The deployment model is the comparison that does matter, because every other tradeoff in this post follows from it. Once you decide who runs the server, most of the rest is already settled.

### Self-hosted (Karakeep)

You own the entire stack. The database sits on your machine or your VPS, no third party reads your saved articles, and you can inspect the source, change it, and run it on your own terms.

That control comes with upkeep.

Docker containers need updating, databases need backups, and if the server goes down at 2am, you are the one awake fixing it before the rest of your homelab notices. If you want AI tagging through Ollama on top of that, you also need a machine with enough RAM to run a local model without grinding the box to a halt.

If you already run a homelab, Karakeep slots into the setup you have. If you don't, it means standing up and maintaining a new piece of infrastructure for the sake of a reading list.

Karakeep handles its side of this well. The Docker setup is straightforward, the docs are solid, and the community is large enough that you will find an answer to most questions you hit on the first search.

### Hosted (Readplace)

You trade control for convenience. I run the servers, the database, the backups, the updates, the SSL, and the monitoring, and what you get back is a URL and a browser extension that work the moment you sign in. The AI TL;DR runs on every saved article with no configuration on your end.

The cost of that trade is trust. Your reading list lives on someone else's server, and for anyone who self-hosts on purpose, that's a real concern, so I don't dismiss it.

## The trust question

If you self-host, you have likely been burned before, because a service you relied on got acquired, shut down, or degraded under new owners until it was not worth using anymore.

"Just trust me" doesn't answer that. Here's what Readplace does in concrete terms instead.

- **Source-available.** The full codebase is public. You can read every line of code that touches your data.
- **Data export.** You can export a JSON list of every saved article at any time, even after you cancel. It carries each article's URL, title, site, excerpt, read status and dates, not the article text.
- **Australian hosting.** Readplace stores accounts and saved articles on AWS in Sydney under Australian privacy law. Readplace sends article text to DeepSeek to clean up the text and write the summary.
- **Clear revenue model.** Paid subscriptions, with no ads, no third-party tracking, and no venture capital.

I can't promise what a hosted service will look like in 5 years. But each of the choices above is checkable today rather than taken on faith, and together they make a hosted service as trustworthy as it can be without putting the database on your own disk.

## Feature comparison

| | Karakeep | Readplace |
|---|---|---|
| **Price** | Free | [Current plans](/?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=pricing#pricing) |
| **Hosting** | Self-hosted (Docker) | Managed |
| **Source code** | Open source | Source-available |
| **AI features** | Auto-tagging, plus summaries on request or opt-in (Ollama / OpenAI) | TL;DR summaries (included) |
| **Browser extensions** | Chrome, Firefox, Safari | Chrome, Firefox |
| **Mobile apps** | iOS, Android | iPhone and Mac (App Store), mobile web elsewhere |
| **Full-text search** | Yes (Meilisearch) | No |
| **Pocket import** | Yes | Yes |
| **Data ownership** | Full (your server) | Export anytime |
| **Setup time** | 15 to 30 min (Docker experience helps) | 2 minutes |
| **Maintenance** | You handle updates, backups, uptime | Handled for you |
| **Community** | About 29,000 GitHub stars (Sep 2026), active Discord | 30 GitHub stars (Sep 2026), GitHub issues and discussions |

## When to pick Karakeep

- You already run a homelab or self-host other services.
- You want the database on your own hardware and full data sovereignty.
- You want AI tagging with a local model so no saved data leaves your network.
- You like tinkering with your tools and do not mind the Docker upkeep.
- You want to contribute to an open-source project with an active community.
- Free matters to you, and Karakeep costs nothing beyond the infrastructure you already pay for.

## Karakeep, Readeck or wallabag

Readeck and wallabag are 2 more self-hosted read-it-later apps that get compared with Karakeep, and all 3 are open source.

| | Karakeep | Readeck | wallabag |
|---|---|---|---|
| **Licence** | AGPL-3.0 | AGPL-3.0 | MIT |
| **Install** | Docker | One Go binary, or the official container image | PHP app, or the wallabag/wallabag Docker image |
| **AI features** | Auto-tagging, plus summaries on request or opt-in (Ollama / OpenAI) | None | None documented |
| **Full-text search** | Yes (Meilisearch) | Yes (text, title, authors, site, labels) | Yes (content, title, URL) |
| **Mobile apps** | iOS, Android | iOS, Android | Android. The iOS app is no longer the official one |
| **Latest release** | [0.33.2, Aug 11, 2026](/view/github.com/karakeep-app/karakeep/releases/tag/v0.33.2?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=read-github-com) | [0.23.4, Sep 17, 2026](/view/codeberg.org/readeck/readeck/src/branch/main/CHANGELOG.md?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=read-codeberg-org) | [2.6.14, Oct 7, 2025](/view/github.com/wallabag/wallabag/releases/tag/2.6.14?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=read-github-com) |
| **Stars (Oct 1, 2026)** | [About 29,000 on GitHub](/view/github.com/karakeep-app/karakeep?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=read-github-com) | [1,128 on Codeberg](/view/codeberg.org/readeck/readeck?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=read-codeberg-org) | [12,994 on GitHub](/view/github.com/wallabag/wallabag?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=read-github-com) |

Readeck runs as one Go binary with SQLite as its default database, and it needs at least [512 MB of RAM](/view/readeck.org/en/docs/?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=read-readeck-org). It exports articles and whole collections as EPUB for an e-reader, but saving PDFs is an [open request, filed Sep 5, 2023](/view/codeberg.org/readeck/readeck/issues/24?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=read-codeberg-org). Its [Get Started page](/view/readeck.org/en/start?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=read-readeck-org) offers self-hosting as the only option today, with a hosted version still marked as coming in 2026.

On the server, wallabag is a PHP app that runs on MySQL, PostgreSQL or SQLite. It also comes hosted as [wallabag.it](/view/wallabag.it/en/pricing/?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=read-wallabag-it), which runs the same open-source code at 4 EUR for 3 months or 11 EUR for a year. It exports to EPUB, PDF, JSON and CSV, and community apps connect it to Kobo, Kindle and PocketBook readers.

Readplace sits apart from all 3 as a hosted-only service, and it writes an AI summary for every saved article with nothing to configure.

## When to pick Readplace

- You would rather not maintain infrastructure for your reading list.
- You want AI summaries working from the first save, with no setup.
- You are comfortable with a hosted service that is source-available and exports a list of what you saved.
- You want a focused, opinionated reading experience over a configurable one.
- You want someone else handling backups, updates, and uptime.
- Paying for a subscription is worth more to you than the hours you would spend maintaining it.

## The honest take

If you enjoy running Docker containers and you want full control over your data, Karakeep is a strong choice. It's well-built, actively maintained, and backed by a large community, and the 29,000 GitHub stars aren't an accident. Nothing here argues a homelab owner away from it.

If you would rather not run infrastructure for a reading list, that is the work Readplace takes off your plate, and you give up self-hosted control in exchange for an app that works the moment you hit save and stays working without you watching it.

Both tools answer the same question with different philosophies: how much of the stack do you want to own? Karakeep hands you the whole stack and the responsibility that comes with it. Readplace hands you a reading list and keeps the servers out of your life. Both answers are fair, so pick the one that matches how you want to spend the hours you would otherwise lose to maintenance.

## Readplace for specific jobs

- [Saving PDFs, scans included](/pdf-ocr?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=pdf-ocr): how scanned pages are read and checked.
- [Moving from Pocket](/pocket-alternative?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=pocket-alternative): what a Pocket export brings across before you make an account.
- [Reading from an AI assistant](/ai-reading-list?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=ai-reading-list): saving to a readlist from ChatGPT, Claude or Gemini.
- [When a subscription ends](/read-it-later-that-wont-die?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=read-it-later-that-wont-die): what stays readable if you stop paying.
- [Reading a PDF on a phone](/pdf-reflow?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=pdf-reflow): a pasted PDF as text that fits the screen.
- [Turning an article into an EPUB](/article-to-epub?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=article-to-epub): a file for a Kobo or Kindle, with no account.
- [Saving newsletter links](/save-newsletter-links?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=save-newsletter-links): an address per newsletter, and only the articles are kept.
- [Compared with Readwise Reader](/readwise-reader-alternative?utm_source=blog-readplace-vs-karakeep-hosted-vs-self-hosted-read-it-later&utm_medium=internal&utm_content=readwise-reader-alternative): the gaps in one table.

---

*Readplace is a read-it-later app for people who read a lot. No ads, no third-party tracking. Try it at [readplace.com](https://readplace.com).*
