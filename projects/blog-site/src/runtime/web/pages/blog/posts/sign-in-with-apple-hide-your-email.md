---
title: "Sign in with Apple Without Handing Over Your Inbox"
description: "Readplace takes a Sign in with Apple login now, Hide My Email and all. Apple hands the site a forwarding address at privaterelay.appleid.com and keeps your real inbox private. That mask only works if Readplace's mail clears Apple's relay check, so the apex now carries the SPF and DKIM records a human reply needs to reach you."
slug: "sign-in-with-apple-hide-your-email"
date: "2026-07-06"
author: "Fayner Brack"
keywords: "sign in with apple read it later, hide my email read later, sign in with apple read later app, apple login reading app, private email relay app, hide my email forwarding read later, readplace sign in with apple, apple id login read it later, no password read later app, sign in with apple email delivery"
tags: ["changelog"]
banner: "I added Sign in with Apple"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

There is now a second way into a Readplace account, and it asks for no password. Tap Sign in with Apple on the login or signup page, approve on Apple's screen, and the account is made. On that screen you can hide your real email, and Apple hands Readplace a forwarding address at privaterelay.appleid.com in place of it. Forwarding only holds if mail sent to the mask clears Apple's relay check, which reads the sending domain's SPF and DKIM signatures. Readplace's automatic article-ready mail already cleared it, sent on its own signed subdomain. A reply typed by a person from a readplace.com address did not, because the apex carried no SPF record and no Workspace DKIM key, so Apple dropped those replies before they reached the hidden inbox. Readplace now publishes both on the apex, so every kind of mail it sends reaches you, masked address or not.

</div>
</details>

Sign in with Apple can hand a website a masked address and forward the mail on to the real inbox behind it. The masked address ends in privaterelay.appleid.com. A person logs in somewhere new, and the site does not learn the inbox they actually read from.

That helps only if the new site can still reach the mask. A login built to hide your inbox is worth little when mail sent to the hidden side lands nowhere.

## What the Apple button adds

Readplace now shows a Sign in with Apple button on the login page and the signup page, next to the one for Google. Tap it, approve on Apple's own screen, and the account exists. No password to invent and no confirmation link to chase.

Apple offers a choice on that screen. Share your real email with the site, or hide it. Choose hide, and Apple creates a single forwarding address ending in privaterelay.appleid.com, unique to Readplace, and keeps your real one to itself. Readplace saves the masked address and treats it as your email, because for the account, it is.

So the button does two jobs. It cuts signup to a couple of taps, and it lets a new reader keep their inbox private while they try the thing out.

## The reply Apple was dropping

A forwarding address is a promise to pass mail on. Apple sits in the middle. It takes what is sent to the mask, checks it, and hands the clean mail to your real inbox. The check is the part that matters here. Apple reads the sending domain's SPF and DKIM records, the two public signatures that vouch a message came from where it claims, and it drops anything that fails them before it reaches you.

Readplace sends you mail in two shapes. One is automatic. The email that tells you a saved article turned readable, [now batched into one digest](/blog/one-email-for-every-ready-article), goes out through a dedicated sending service on its own signed subdomain. That shape already cleared Apple's check and reached masked inboxes.

The other shape is a person writing to you. Reply to Readplace, or write to the support address, and a human answers from a readplace.com address running on Google Workspace. That mail leaves under the bare readplace.com apex. The apex carried no SPF record and no Workspace DKIM key of its own.

So a reply sent to someone's privaterelay.appleid.com address reached Apple's relay, failed the SPF and DKIM check, and was dropped. The reader saw nothing. They had written to Readplace and heard back only silence, which is the worst way for a hidden address to behave.

> **A login built to hide your inbox is only real if the hidden address still receives.**

## Signing the mail the apex sends

The fix gave the apex the signatures it lacked. Readplace publishes an SPF record on readplace.com now, `v=spf1 include:_spf.google.com ~all`, which states that Google Workspace may send as the domain. Next to it sits the Workspace DKIM key, a 2048-bit public key at `google._domainkey.readplace.com`, so each message carries a signature Apple can check against it.

One wrong turn on the way is worth naming. The apex already held a Google site-verification record, and DNS allows a single TXT set per name. Adding SPF as its own separate record collided with the one already there, and the deploy failed on a flat "already exists". The whole apex TXT set had to be owned as one list, the SPF line placed beside the verification token it had been colliding with, before the change would ship.

With both records live, a reply from a readplace.com address clears Apple's relay check and reaches the real inbox behind the mask.

```rp-figure
kind: matrix
title: The two shapes of Readplace mail at Apple's relay
note: Apple drops mail that fails the sending domain's SPF and DKIM check, so the apex now publishes both.
toggle: After the apex published SPF and DKIM
head: What Readplace sends | Automatic article-ready mail | A reply a person types
row: Leaves under | Its own signed subdomain>>Its own signed subdomain | The bare readplace.com apex>>The bare readplace.com apex
row: Apple's relay check | Already cleared it>>Clears it | !Failed the SPF and DKIM check>>Clears it
row: Mail to a privaterelay.appleid.com mask | Reached masked inboxes>>Reaches masked inboxes | !Dropped before it reached the hidden inbox>>Reaches the real inbox behind the mask
```

> **The masked address keeps its promise now, for the automatic mail and the reply a person types alike.**

## Log in as Apple, still get reached

For a reading app, the value in Sign in with Apple is the steps it removes in front of a new reader. Two taps, with nothing to remember and nothing to confirm. Hide My Email is what makes that easy to trust, because handing a real address to a service you met a minute ago is the exact pause the mask takes away.

For that trust to hold, the mail has to arrive. A masked inbox that swallows the one reply you waited on teaches you to distrust the mask, and the login with it. So the SPF and DKIM work is part of the login, not a detail hung off it. Without both records, the button would let you hide an address Readplace then could not reach.

The button is on the [login screen](https://readplace.com/login) and the [signup screen](https://readplace.com/signup) today. On an iPhone it sits alongside [the in-app reader](/blog/read-saved-articles-in-the-iphone-app) and the [share-sheet save](/blog/save-pdf-from-iphone-share-sheet) already there. Sign in with Apple, hide your email if you like, and Readplace still knows how to reach you.
