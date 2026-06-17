---
title: "How Readplace Measures Its Site Without Third-Party Trackers"
description: "Readplace runs no Google Analytics, no ad pixels, and no outside scripts. It measures traffic with a salted IP hash and one anonymous first-party cookie that stays on its own servers."
slug: "no-third-party-trackers"
date: "2026-06-04"
author: "Fayner Brack"
keywords: "privacy read it later, no third-party trackers, no Google Analytics, first-party analytics, anonymous cookie, Pocket alternative privacy, cookieless analytics, read it later privacy"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Readplace runs no third-party analytics. No Google Analytics, no ad pixels, no scripts from other companies. It measures traffic two ways. A salted one-way hash of your IP counts visitors in the server logs. One anonymous first-party cookie connects a first visit to a first saved article. Both stay on Readplace's own servers. A read-it-later app holds a private record of what you read, so the measurement matches that promise.

</div>
</details>

Open the network tab on most apps and you find a crowd. Google Analytics, a few ad pixels, a session recorder, tag managers that load more tags, and each one ships a little of your behaviour to a company you did not pick.

Open the same tab on Readplace and the list is short.

The app loads its own code, one login cookie, one measurement cookie, and not much beyond that.

A read-it-later app sees what you save. Your queue is a record of what you worry about, what you want to learn, and the things you keep to yourself. That list deserves better than an ad network.

I still want to know whether the product works. Did a Hacker News post send 100 readers or 5? Do people who try the public reader come back and save something? Two small tools answer questions like those, and both run on my own servers.

## The IP hash counts visitors

The first tool is a salted hash.

Take a visitor's IP address, mix in a secret that lives only on the server, run it through SHA-256, and keep 16 characters of the result.

The same IP makes the same short string. So I can tell 100 real readers from 3 people hitting refresh, without storing anyone's address.

The hash runs one way, which means the logs cannot turn back into an IP, and the secret stays on the server. It counts the visit and forgets who you are.

## One cookie links a first visit to a first save

The hash has a limit.

It cannot follow a single person from the homepage to the moment they save their first article, because people share office Wi-Fi and switch from phone to laptop, and the hash blurs those steps together.

So I added one cookie. It holds a random id and nothing else, with no name, no email, and no link to your account until you sign in.

It sets on your device, it reports back only to Readplace, and it shows me the path from first visit to first save.

That cookie is first-party. It does not ride along to other sites, and it does not feed an ad profile anywhere.

## The short list I hold

Here is the full list of what loads in your browser on a Readplace page: the app's own code, one session cookie to keep you logged in, and one anonymous cookie to measure the funnel.

The privacy policy says the same thing in plain words, last updated on 3 June 2026.

Plenty of reading apps promise privacy on the marketing page, then load Google Analytics on that same page, so the promise and the code disagree. I would rather the code match the promise, even when nobody is checking.

## Check it yourself

You do not have to take my word for any of this.

Open your browser's developer tools, load readplace.com, and read the network and cookie tabs. Count what loads, and count what gets set.

Then start a queue and watch how little it costs you to do that. Save your first article at [readplace.com](/).
