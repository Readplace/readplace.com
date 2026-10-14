---
title: "A Charge You Can See Coming"
description: "Readplace shows the exact date and amount of your next renewal on the account page, under the plan it renews. The number is read live from the billing provider when its stored copy goes stale, hidden inside the iPhone app to satisfy App Store rules, and paired with a live cancelling state that heals into a one-tap reactivate."
tldr: "Subscription pages tend to stay quiet about money until the day the card is charged. Readplace's account page does the reverse. Under the plan and its price, it shows the exact date the next charge falls and the exact amount, read from the billing provider and shown in your own currency. The figure is cached on your subscription record and refetched only when the stored copy is missing, stale, or sitting in the past, so most of the year nothing is fetched at all. Cancel, and the card shows a live Cancelling state while the request runs, then settles into your subscription's end date with a one-tap Reactivate. Inside the iPhone app the price line is stripped, because App Store rules object to a web page naming a price. The reminder that goes out before a free trial ends now says where a subscription's money goes, too. None of the billing is hidden until after it has already happened."
slug: "next-charge-shown-before-it-lands"
date: "2026-07-14"
lastModified: "2026-10-14"
author: "Fayner Brack"
keywords: "when will I be charged subscription, see next charge date read it later, read it later app subscription cost, no surprise renewal reading app, cancel read it later subscription, reactivate subscription read later, read it later free trial no card, transparent subscription billing app, subscription renewal reminder, read it later app pricing"
tags: ["changelog"]
banner: "I made the account page show your next charge before it lands"
---

Once a year, a Readplace subscription renews. For the other 11 months, the account page said nothing about that at all.

That silence was the safe default, and it was the wrong one. A charge you can't see coming is a charge you find out about only after it has landed.

The account page shows the next one now. It names the day the card will be charged and the sum that will leave the account.

## The line that sits under the price

The line sits in the plan summary, under the plan's name and its price. Placed there, the date reads as part of the plan, the same way the price above it does.

So the line stays for as long as a charge is coming, a week out or 11 months out. That leaves room to update a card, to cancel, or to simply not be surprised on the morning it hits.

A charge dated in the past is not a charge to come, so the line hides. A reader whose card is failing, caught in the retries a provider runs before it gives up, would otherwise be told they will be billed on a day that has already gone. That reader has enough to deal with.

> **A price says what a plan costs, and the date under it says when that cost lands.**

## A number read live, then held

The date and amount live in two places. One is your subscription record, where the last known renewal is stored. The other is the billing provider, which holds the real one.

The page reads the stored copy first. If it is still in the future, that is the answer, and nothing else is asked. If it is missing, or stale, or a date already gone, the page fetches the live figure from the provider and writes it back before showing it.

So the stored copy is a cache with one rule for going bad: a charge in the past. That makes the pair self-correcting. The stored number can only be wrong in the gap between a renewal and your next visit to the page, and that visit repairs it. On a yearly plan, most of the year, the page fetches nothing.

The amount comes back in minor units, the cents behind a dollar or the pennies behind a pound. The page divides by the right power of 10 for the currency it is in, which is not always 100. The yen carries no minor unit, so a yen figure is shown whole. What lands on the line is the sum the provider will actually take, in the currency it will take it.

## Cancelling that says so as it runs

Cancelling used to be a button that went quiet the moment you pressed it. The request went off to the provider, and the page sat still until it came back, with nothing on screen to say the press had landed.

It says so now. Press Cancel and the control reads Cancelling while the request runs, and the card checks for the result on its own. When the provider confirms, the card rewrites itself: the status becomes the date your subscription ends, and a Reactivate button appears.

That reactivate path counts as much as the cancel. Changing your mind is a single press, not an email to a person. The subscription you cancelled on Tuesday is one tap back on Wednesday, right up to the day it actually ends.

> **The button that cancels and the button that brings you back are both yours to press, no one in the loop.**

## Why the iPhone hides the price

Open the same account page inside the Readplace iPhone app and the renewal line is gone. Apple's [App Store rules](/view/developer.apple.com/app-store/review/guidelines/?utm_source=blog-next-charge-shown-before-it-lands&utm_medium=internal&utm_content=read-developer-apple-com) don't allow a web view inside an app to name a subscription price, so the line is stripped before the page renders on that surface. The status, the cancel control, and [the way out of the account](/blog/delete-your-account-with-a-typed-phrase?utm_source=blog-next-charge-shown-before-it-lands&utm_medium=internal&utm_content=post-delete-your-account-with-a-typed-phrase) all stay. The one thing removed is the number, and only where a rule asks for it.

```rp-figure
kind: rule
title: Whether the next charge line shows, and where its number came from
note: The past-date rule, the cache rule, and the one surface where the number is stripped.
choice: The renewal date | still to come | a day already gone
flag: The stored copy is missing, stale, or already past
flag: Opened inside the Readplace iPhone app
when: f2 -> no | Hidden | Apple's App Store rules don't allow a web view inside an app to name a subscription price, so the line is stripped before the page renders on that surface.
when: c1=2 -> no | Hidden | A charge dated in the past is not a charge to come, so the line hides.
when: f1 -> ok | Shown live | Missing, stale, or a date already gone, so the page fetches the live figure from the provider and writes it back before showing it.
else: ok | Shown | The stored copy is still in the future, so that is the answer, and nothing else is asked.
```

## Seeing the bill is part of trusting the app

There is no company behind Readplace and no investors, just one person paying the cloud bills. No card is asked for up front, so a trial that ends charges nothing and drops the account to read-only rather than billing you by surprise. The reminder before a trial ends says that plainly now, and says a subscription covers those bills and the hours spent building the thing, with the blog left free to read. It states where the money goes and stops. Whether that is worth it is yours to weigh.

A page that shows the charge before it lands belongs to the same idea. A subscription that is easy to start should be just as easy to see and just as easy to leave. An app that hides the next charge until the day it takes it is asking for a trust it has not earned.

## Where your next charge shows

If you are on a trial or already subscribed, open your account page and the date and amount are sitting there, in your own currency. Whether you stay or cancel, a saved copy of everything you kept [outlasts the pages it came from](/blog/saved-articles-outlast-the-original-page?utm_source=blog-next-charge-shown-before-it-lands&utm_medium=internal&utm_content=post-saved-articles-outlast-the-original-page). A readlist of your own starts at [readplace.com](/?utm_source=blog-next-charge-shown-before-it-lands&utm_medium=internal&utm_content=home).

Showing a price before someone subscribes is the easy half. Showing it before every charge after that is the half that counts.
