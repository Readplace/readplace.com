---
title: "Still Signed In After a Month Away"
description: "A fortnight away from the iPhone app, the browser extensions or a connected assistant used to end with Readplace signing you out, because nothing had ever set a sign-in's lifetime and a library default answered instead: 14 days. The code's own comments promised 180. Production measured 13.96. One configuration line now makes the comments true, and any visit resets the clock."
slug: "still-signed-in-after-a-month-away"
date: "2026-09-20"
author: "Fayner Brack"
keywords: "app keeps signing me out, stay signed in, read it later app signs me out, refresh token lifetime, oauth2-server default, session expired after two weeks, signed out for no reason, readplace"
tags: ["changelog"]
banner: "I fixed the sign-out that followed 2 weeks away"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Nothing had ever told Readplace's sign-in system how long a sign-in should last, so a library default decided: 14 days. Anyone who left the iPhone app, a browser extension or a connected assistant alone for a fortnight came back signed out, with no message saying why. A sign-in now survives 180 days of absence, any visit resets the clock, and signing out on purpose still takes effect right away.

</div>
</details>

On paper, a Readplace sign-in survives 180 days of neglect. A comment in the OAuth client store promises a client record that outlives "the 180-day refresh-token lifetime". A fallback in the token model names the same 180. 2 readers of the code, months apart, took the number at face value.

The tokens in production expired a fortnight after their last use. Every row I sampled said so, 40 of 40.

Those rows covered the iPhone app, the Chrome and Firefox extensions, and the assistants readers had connected through. A sign-in on any of them, left untouched for 14 days, was gone.

## What a reader saw

No error fired anywhere. The extension of someone back from 3 weeks of travel asked for a sign-in before it would save again, and the app asked for the password it had asked for a month earlier. No screen said a sign-in had expired, so the natural reading was that you had done something wrong. You hadn't, and it had been happening for months.

## The fortnight came from a default

Readplace's sign-ins run on [oauth2-server](/view/github.com/node-oauth/node-oauth2-server?utm_source=blog-still-signed-in-after-a-month-away&utm_medium=internal&utm_content=read-github-com) behind an Express wrapper. The configuration handed to it named the token model and the client rules, and said not one word about lifetimes. The library fills that silence with defaults: 14 days for a refresh token, 1 hour for an access token.

The proof sat in the arithmetic. Every sampled row carried a refresh expiry sitting 13.96 days past its access expiry, and 14 days minus 1 hour is 13.96 days. The difference was the library's signature. The code that existed had no bug in it. The bug was the line that didn't exist.

## The comment that kept it hidden

How does a 2-week expiry go unnoticed for months in a product whose author believes the number is 180? The code answered questions faster than production could. The client store justifies its 1-year record lifetime as sitting comfortably past "the 180-day refresh-token lifetime", and the token model carries a 180-day fallback on a branch the live paths can't reach. Read either one and you stop looking.

> **A number a comment explains with confidence is a number that stops getting checked.**

That is how both readers of this code reached the same wrong number. Neither looked at a stored token, because the comments made looking feel unnecessary.

## 1 line, and why 180

The fix I shipped is 1 configuration line: a refresh-token lifetime of 180 days, stated where the OAuth server is built instead of inherited from a package.

180 rather than a year is a bound, not a taste. A connected assistant's client record lives 365 days, and a sign-in must not outlive the record it resolves through, so 180 leaves comfortable room inside the record's own lifetime.

Tokens issued before the change keep their fortnight until their next refresh, which grants the 180-day window. An app or extension that checks in within the old 14 days upgrades without showing you anything. If you're mid-absence right now, 1 more sign-in form is coming, and it is the last one a fortnight away can cause.

## Idle is the only thing forgiven

Longer is not looser. A refresh token is still single-use and a replayed one is still refused, and logout, logout-everywhere and account deletion still revoke on the spot. The 180 days bound one thing only, how long an untouched sign-in stays alive, and any visit resets the count. In practice the reader who types a password again is the one who stayed away a full 6 months.

2 tests now hold the number. Each runs a real token exchange against the live routes, 1 for a fresh sign-in and 1 for a renewal, then reads the stored expiry back and requires 180 days. Remove the configuration line and exactly those 2 fail, reporting the library's fortnight.

One boundary worth naming: the website in a browser signs in through its own cookie with its own shorter window, and that window didn't move this week. This change covers what runs on tokens, which is the iPhone app, the browser extensions, and connected assistants like ChatGPT and Claude.

## Built for coming back

A read-it-later product makes a strange promise: leave, and your reading will still be here. The sign-in was the one part of Readplace not keeping it. That promise now includes the sign-in.

A sign-in made today in [the browser extension](https://readplace.com/install) or [the iPhone app](/blog/readplace-iphone-app-on-the-app-store?utm_source=blog-still-signed-in-after-a-month-away&utm_medium=internal&utm_content=post-readplace-iphone-app-on-the-app-store) now outlasts any break in your reading shorter than 6 months. Whatever you save tonight opens without a password when its evening finally comes. [Your readlist](/?utm_source=blog-still-signed-in-after-a-month-away&utm_medium=internal&utm_content=home) will be exactly where you left it.
