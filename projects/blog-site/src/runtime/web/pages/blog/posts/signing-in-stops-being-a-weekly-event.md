---
title: "Signing in stops being a weekly event"
description: "A hardcoded 7-day expiry signed every web reader out weekly, no matter how often they came back, and a refresh-token race in the browser extension caused about 1 automatic sign-out a day on its own. Sessions now slide 180 days ahead on any day with a visit, the extension stops spending doomed token rotations, and signing out goes back to being the reader's own decision."
slug: "signing-in-stops-being-a-weekly-event"
date: "2026-09-23"
author: "Fayner Brack"
keywords: "stay signed in, app keeps logging me out, session expired after 7 days, sliding session expiry, refresh token rotation race, browser extension signed out, read it later app, readplace"
tags: ["changelog"]
banner: "The sign-outs you didn't ask for have stopped"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Sessions on the website used to expire 7 days after login, no matter how much reading happened in between, and a token race in the browser extension was ending about 1 session a day on top of that. Readplace now slides the expiry instead: any day with a visit pushes it 180 days out, and the extension stops spending a second token rotation on a refusal another tab already answered. Signing out becomes something the reader does, not something that happens to them.

</div>
</details>

7 days after a login, readplace.com signed the reader out. Coming back daily did not move the date: the expiry was stamped once, at sign-in, and no code path touched it after that.

Production put a number on the cap. Of 88 live sessions on the day of the fix, the longest had 6.89 days left. Every signed-in reader was inside a week of a forced sign-in.

## A literal that outlived its commit

The 7 was not a product decision. It arrived as a bare literal in an old commit that needed a number, and it went on to decide when 88 people had to type a password again.

> **A placeholder that draws no complaint hardens into policy.**

For an app whose loop is a save on Tuesday and a read 2 weekends later, a week is the wrong unit. The sign-in wall came back mid-habit, on whatever screen the reader happened to open next.

## The extension was racing itself

The browser extension had a second sign-out of its own, and it was faster than the timer.

Its refresh tokens are single-use: spending one returns a fresh pair and retires the old. When 2 requests were refused in the same moment, each went to refresh. The first rotation succeeded. The second replayed a token the first had just consumed, the server turned it away, and the extension concluded the session was over and signed out. On the way out it revoked the newest refresh token, the one the server still accepted.

8 days of credential history showed 18 of those double rotations, 2 spends on one grant landing as close as 0.15 seconds apart, and about 1 automatic sign-out a day across roughly 12 installs. A signed-out extension is a save button that stops working, and the reader in front of it had done nothing but open 2 tabs.

## The expiry follows the reader now

On the web the session slides. A signed-in request that finds its session stamped more than a day ago pushes the expiry to 180 days out and re-sends the cookie on the same response. Reading daily costs the database 1 extra write a day. Disappearing for a season still gets caught on the first day back. The 180 matches the lifetime of the refresh tokens the extension holds, so both surfaces now agree on how long an absence can run.

In the extension, a refusal now says which token it happened to. The refresh call carries the access token the refused request was using, and when storage already holds a different one, another request has been through here first. The extension replays the newer token and spends no rotation at all.

One more route had to change for the 180 to be safe. The endpoint the extension calls to open a web session minted a fresh session on every call without reading the cookie it was sent, and 1 reader collected 17 session rows in a single morning. At 7 days those orphans died young. At 180 they would have lived 26 times longer, so the endpoint now renews the session it was handed when it belongs to the same account, and mints only when there is nothing to renew.

## What ends a session now

Signing out does, on the spot. A password reset and an account deletion do too: the renewal is written as a conditional update, so an ending that races it wins, and no session comes back from the dead. And 180 days without a single visit ends one, which is the timer doing its actual job.

What no longer ends a session is showing up every day and being signed out on the 8th.

## Sign in one more time

There is nothing to switch on. The next sign-in at [readplace.com](/?utm_source=blog-signing-in-stops-being-a-weekly-event&utm_medium=internal&utm_content=home) is the one the timer stops counting against, and [the browser extension](https://readplace.com/install) goes back to being a save button instead of an occasional login form.
