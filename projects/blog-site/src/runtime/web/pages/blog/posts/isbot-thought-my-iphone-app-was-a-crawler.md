---
title: "isbot Thought My iPhone App Was a Crawler"
description: "A read-it-later app named Readplace starts its native User-Agent with the word read, and the bot-detection library in its analytics flags exactly that prefix as a crawler. For 90 days, 11% of mark-as-read events counted as bot traffic even though each one came from a signed-in reader. The fix exempts one exact User-Agent, anchored so a real crawler can't wear it."
slug: "isbot-thought-my-iphone-app-was-a-crawler"
date: "2026-08-23"
author: "Fayner Brack"
keywords: "isbot false positive, cfnetwork user agent, bot detection false positive, user agent device detection, self-hosted analytics, ios app user agent, crawler detection, read it later app, readplace"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

An app whose User-Agent opens with the word "read" walks straight into a bot-detection pattern that flags exactly that prefix. So for 90 days, Readplace's own iPhone app was filed as a crawler in the analytics: 17 of 155 mark-as-read events, 11%, carried the bot label even though each one required a signed-in reader. The share extension went wrong the other way and counted as a desktop browser. Both clients now match on their one exact User-Agent, anchored front and back so a real crawler can't borrow the exemption, and the audience numbers describe people again.

</div>
</details>

There are 183 patterns in [isbot](/view/github.com/omrilotan/isbot), the library that tells Readplace's [vendor-free analytics](/blog/analytics-without-a-vendor) which requests come from crawlers. One of them is `^read`. A User-Agent that opens with those 4 letters gets called a bot and asked nothing further. I named this product Readplace.

The iPhone app introduces itself to the server as `Readplace/94 CFNetwork/3860.700.1 Darwin/25.6.0`. The first 4 letters settled it.

## A bot that marked an article read

The analytics stamp every event with a device class: desktop, mobile, tablet or bot. This week I pulled 90 days of mark-as-read events and found 17 of the 155 stamped as bot. 11% of the reading, credited to machines.

A mark-as-read event can't come from a machine. It fires after a signed-in account flips a saved article to read, on a route the server guards with authentication, and a crawler holds no account and no session. Each of those 17 rows was a person with an iPhone, finishing an article.

The error sat in the one direction a dashboard doesn't complain about. Traffic that looks too big invites a second look. Readers filed under a label built to be ignored just go missing.

## The User-Agent Apple wrote for me

The app didn't choose that introduction. An iOS app that sets no User-Agent of its own gets a default from Apple's networking stack: the target's name, its build number, then CFNetwork and Darwin versions. My app target is called Readplace and its build was 94, so every request the app's own code makes opens with the word Read.

The pattern isn't unreasonable either. Fetchers that pull articles for a living have shipped read-something names for years, and on the wider web `^read` earns its keep. It has no way of telling a reading robot from an app built for readers.

The share extension went wrong in the opposite direction. Its target is named ShareExtension, so no pattern fires, and its User-Agent carries no iPhone token, so the classifier's fall-through called it a desktop browser. Same cause both times: a name I picked for an Xcode target was acting as an interface.

## An exemption that can't be borrowed

The tempting fix is one line. If the User-Agent contains Readplace, it isn't a bot.

That line is a door with the key taped to it. A scraper that wants past the server's bot checks would only have to type 9 letters into a header it already controls.

So the exemption matches the whole sentence rather than a word in it. Start of string, one of the 2 app names, a slash, a bare integer build, the CFNetwork segment, the Darwin segment, end of string. `ReadplaceBot/2.1` still reads as a bot. So does `Googlebot` with `Readplace/94` pasted into its middle, and so does the real app string with anything at all appended.

> **An exemption a crawler can put on is worse than the false positive it fixes.**

The same check now answers for the 2 cookies the server grants only to people: the one that walks an anonymous save through signup, and the one that remembers the last article a guest read. The app can't reach either path today, because its reader is a web view speaking Safari's User-Agent. But 2 gates holding 2 definitions of bot is how the next version of this bug gets written.

## 3 gates I left alone

Not every isbot call got the exemption.

The install page reads the User-Agent to route each visitor to their own setup steps, and a native app matches none of its branches, so the fall-through is ChatGPT's. Exempt the app there and an iPhone request would be answered with instructions for connecting ChatGPT.

The homepage experiment stayed bare too. The app gets redirected before the homepage, and enrolling a client that renders no homepage would water the experiment down. The browser column still files the app as "other", because the app is not a browser and "other" is the accurate family.

## Readers counted as readers

Mark-as-read events from the app land as mobile_ios now. The share extension's saves stopped padding the desktop column. What the bot column holds is bots.

What gets kept did not change. The classifier reads the raw User-Agent, writes down the class, and drops the string, so the stream still holds no User-Agent for anyone. That is the standing trade of [running analytics with no third-party trackers](/blog/no-third-party-trackers): fewer columns, and each one I can read out loud.

TBH the 11% wasn't the part that stung. A wrong label costs no error and no failed request, so nothing complains... it sits in the data until a person finds a number odd. This one sat for 90 days in a pipeline one person reads.

The row for the next article you finish in [the iPhone app](/blog/readplace-iphone-app-on-the-app-store) lands in the right column, and the queue it belongs to starts at [readplace.com](/).
