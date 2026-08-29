---
title: "A Charge You Can See Coming"
description: "Readplace shows the exact date and amount of your next renewal on the account page, but only in the 30 days before it lands. The number is read live from the billing provider when its stored copy goes stale, hidden inside the iPhone app to satisfy App Store rules, and paired with a live cancelling state that heals into a one-tap reactivate."
slug: "next-charge-shown-before-it-lands"
date: "2026-07-14"
author: "Fayner Brack"
keywords: "when will I be charged subscription, see next charge date read it later, read it later app subscription cost, no surprise renewal reading app, cancel read it later subscription, reactivate subscription read later, read it later free trial no card, transparent subscription billing app, subscription renewal reminder, read it later app pricing"
tags: ["changelog"]
banner: "I made the account page show your next charge before it lands"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Subscription pages tend to stay quiet about money until the day the card is charged. Readplace's account page does the reverse. In the 30 days before a renewal it shows the exact date the charge falls and the exact amount, read from the billing provider and shown in your own currency. Outside that window it shows nothing, because a renewal 11 months out is a number you learn to read past. The figure is cached on your subscription record and refetched only when the stored copy is missing, stale, or sitting in the past, so most of the year nothing is fetched at all. Cancel, and the card shows a live Cancelling state while the request runs, then settles into your subscription's end date with a one-tap Reactivate under it. Inside the iPhone app the price line is stripped, because App Store rules object to a web page naming a price. The reminder that goes out before a free trial ends now says where a subscription's money goes, too. None of the billing is hidden until after it has already happened.

</div>
</details>

Once a year, a Readplace subscription renews. For the other 11 months, the account page said nothing about that at all.

That silence was the safe default, and it was the wrong one. A charge you can't see coming is a charge you find out about only after it has landed.

The account page shows the next one now. It names the day the card will be charged and the sum that will leave the account, and it does that only when the charge is close enough to act on.

## The line that shows up only in time

A yearly plan renews once. A renewal date printed every day of the year is a number you stop seeing, the way you stop reading a sign that never changes.

So the line has a window. It appears in the 30 days before the charge and stays hidden the rest of the year. Thirty days is room enough to update a card, to cancel, or to simply not be surprised on the morning it hits.

The window has a second edge. A charge dated in the past is not a charge to come, so the line hides then too. A reader whose card is failing, caught in the retries a provider runs before it gives up, would otherwise be told they will be billed on a day that has already gone. That reader has enough to deal with.

> **A renewal date shown every day of the year is one you train yourself to ignore.**

## A number read live, then held

The date and amount live in two places. One is your subscription record, where the last known renewal is stored. The other is the billing provider, which holds the real one.

The page reads the stored copy first. If it is still in the future, that is the answer, and nothing else is asked. If it is missing, or stale, or a date already gone, the page fetches the live figure from the provider and writes it back before showing it.

So the stored copy is a cache with one rule for going bad: a charge in the past. That makes the pair self-correcting. The stored number can only be wrong in the gap between a renewal and your next visit to the page, and that visit repairs it. On a yearly plan, most of the year, the page fetches nothing.

The amount comes back in minor units, the cents behind a dollar or the pennies behind a pound. The page divides by the right power of 10 for the currency it is in, which is not always 100. The yen carries no minor unit, so a yen figure is shown whole. What lands on the line is the sum the provider will actually take, in the currency it will take it.

## Cancelling that says so as it runs

Cancelling used to be a button that went quiet the moment you pressed it. The request went off to the provider, and the page sat still until it came back, with nothing on screen to say the press had landed.

It says so now. Press Cancel and the control reads Cancelling while the request runs, and the card checks for the result on its own. When the provider confirms, the card rewrites itself: the status becomes the date your subscription ends, and a Reactivate button appears under it.

That reactivate path counts as much as the cancel. Changing your mind is a single press, not an email to a person. The subscription you cancelled on Tuesday is one tap back on Wednesday, right up to the day it actually ends.

> **The button that cancels and the button that brings you back are both yours to press, no one in the loop.**

## Why the iPhone hides the price

Open the same account page inside the Readplace iPhone app and the renewal line is gone. Apple's [App Store rules](/view/developer.apple.com/app-store/review/guidelines/) don't allow a web view inside an app to name a subscription price, so the line is stripped before the page renders on that surface. The status, the cancel control, and [the way out of the account](/blog/delete-your-account-with-a-typed-phrase) all stay. The one thing removed is the number, and only where a rule asks for it.

```rp-figure
kind: rule
title: Whether the next charge line shows, and where its number came from
note: The window, the cache rule, and the one surface where the number is stripped.
choice: The renewal date | inside the 30 days before the charge | further out than 30 days | a day already gone
flag: The stored copy is missing, stale, or already past
flag: Opened inside the Readplace iPhone app
when: f2 -> no | Hidden | Apple's App Store rules don't allow a web view inside an app to name a subscription price, so the line is stripped before the page renders on that surface.
when: c1=3 -> no | Hidden | A charge dated in the past is not a charge to come, so the line hides then too.
when: c1=2 -> no | Hidden | The line has a window. It appears in the 30 days before the charge and stays hidden the rest of the year.
when: f1 -> ok | Shown live | Missing, stale, or a date already gone, so the page fetches the live figure from the provider and writes it back before showing it.
else: ok | Shown | The stored copy is still in the future, so that is the answer, and nothing else is asked.
```

## Seeing the bill is part of trusting the app

There is no company behind Readplace and no investors, just one person paying the cloud bills. No card is asked for up front, so a trial that ends charges nothing and drops the account to read-only rather than billing you by surprise. The reminder before a trial ends says that plainly now, and says a subscription covers those bills and the hours spent building the thing, with the blog left free to read. It states where the money goes and stops. Whether that is worth it is yours to weigh.

A page that shows the charge before it lands belongs to the same idea. A subscription that is easy to start should be just as easy to see and just as easy to leave. An app that hides the next charge until the day it takes it is asking for a trust it has not earned.

## Where your next charge shows

If you are on a trial or already subscribed, open your account page in the 30 days before your renewal and the date and amount are sitting there, in your own currency. Outside that window the quiet is the feature working, and a saved copy of everything you kept [outlasts the pages it came from](/blog/saved-articles-outlast-the-original-page) either way. A readlist of your own starts at [readplace.com](/).

Showing a price before someone subscribes is the easy half. Showing it before every charge after that is the half that counts.
