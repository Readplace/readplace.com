---
title: "How Readplace Measures Its Site Without Third-Party Trackers"
description: "Readplace runs no Google Analytics, no ad pixels, and no tracking scripts. It measures traffic with a salted IP hash and two anonymous first-party cookies that stay on its own servers."
slug: "no-third-party-trackers"
date: "2026-06-04"
author: "Fayner Brack"
keywords: "privacy read it later, no third-party trackers, no Google Analytics, first-party analytics, anonymous cookie, Pocket alternative privacy, cookieless analytics, read it later privacy"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Readplace runs no third-party analytics. No Google Analytics, no ad pixels, no tracking scripts from other companies. It measures traffic two ways. A salted one-way hash of your IP counts visitors in the server logs. Two anonymous first-party cookies connect a first visit to a first saved article. Both stay on Readplace's own servers. A read-it-later app holds a private record of what you read, so the measurement matches that promise.

</div>
</details>

Open the network tab on most apps and you find a crowd. Google Analytics, a few ad pixels, a session recorder, tag managers that load more tags, and each one ships a little of your behaviour to a company you did not pick.

Open the same tab on Readplace and the list is short.

The app loads its own code, one web font from a public CDN, one login cookie, two measurement cookies, and not much beyond that.

A read-it-later app sees what you save. Your readlist is a record of what you worry about, what you want to learn, and the things you keep to yourself. That list deserves better than an ad network.

I still want to know whether the product works. Did a Hacker News post send 100 readers or 5? Do people who try the public reader come back and save something? Two small tools answer questions like those, and both run on my own servers.

## The IP hash counts visitors

The first tool is a salted hash.

Take a visitor's IP address, mix in a secret that lives only on the server, run it through SHA-256, and keep 16 characters of the result.

The same IP makes the same short string. So I can tell 100 real readers from 3 people hitting refresh, without storing anyone's address.

The hash runs one way, which means the logs cannot turn back into an IP, and the secret stays on the server. It counts the visit and forgets who you are.

## Two cookies link a first visit to a first save

The hash has a limit.

It cannot follow a single person from the homepage to the moment they save their first article, because people share office Wi-Fi and switch from phone to laptop, and the hash blurs those steps together.

So I added two cookies. One holds a random id and nothing else, with no name, no email, and no link to your account until you sign in. The other records where you landed and which campaign sent you.

They set on your device, they report back only to Readplace, and together they show me the path from first visit to first save.

Those cookies are first-party. They do not ride along to other sites, and they do not feed an ad profile anywhere.

## The short list I hold

Here is the full list of what loads in your browser on a Readplace page: the app's own code, the Inter web font from Google Fonts, one session cookie to keep you logged in, two anonymous cookies to measure the funnel, and a few functional cookies that remember things like a banner you dismissed or a save you started before signing in. The icons are inline SVG in the page itself, so they come from the same server as everything else.

That leaves the font as the only thing on the list I do not serve myself. It used to have company. The small library that powers the interface came from a public CDN until I moved it onto Readplace's own servers, which took one request off the list and one company off the set of people who can see that you loaded a page here.

The privacy policy says the same thing in plain words.

Plenty of reading apps promise privacy on the marketing page, then load Google Analytics on that same page, so the promise and the code disagree. I would rather the code match the promise, even when nobody is checking.

## Check it yourself

You do not have to take my word for any of this.

Open your browser's developer tools, load readplace.com, and read the network and cookie tabs. Count what loads, and count what gets set.

Then start a readlist and watch how little it costs you to do that. Save your first article at [readplace.com](/).
