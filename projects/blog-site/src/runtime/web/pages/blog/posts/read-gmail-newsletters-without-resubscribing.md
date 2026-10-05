---
title: "Read Your Gmail Newsletters Without Re-subscribing"
description: "The newsletters you never moved out of Gmail can now reach your reading app. Connect the account they already arrive in, pick the senders worth keeping, and the articles inside each new issue save to your readlists as readable, summarized articles. The one change made inside Gmail is a forwarding filter you can read in your own settings."
slug: "read-gmail-newsletters-without-resubscribing"
date: "2026-10-04"
author: "Fayner Brack"
keywords: "read gmail newsletters, gmail newsletter reader, save newsletters from gmail to read later, newsletter overload gmail, connect gmail to read it later app, newsletters to reading list, gmail integration read later, extract articles from newsletters, readplace"
tags: ["changelog"]
banner: "Newsletters buried in Gmail can feed your readlists now"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

A newsletter subscription no longer has to move before the reading can. Connect the Gmail account your newsletters already arrive in, choose the senders worth keeping, and Readplace saves the articles inside each new issue to your readlists, crawled and summarized like any link you paste. Choosing senders works from your own mailbox, delivery runs through one Gmail forwarding filter, and an optional import fetches the unread issues from the last 30 days. The integration ships as a Beta, and connecting is part of the paid subscription.

</div>
</details>

One filter. Connecting a Gmail account to Readplace changes exactly one thing inside that account: a forwarding rule, sitting in your own Gmail settings, scoped to the senders you picked. Nothing gets sent, altered or deleted on your behalf.

The restraint matters because of what the connection is for. [Newsletter overload](/blog/newsletter-overload?utm_source=blog-read-gmail-newsletters-without-resubscribing&utm_medium=internal&utm_content=post-newsletter-overload) got its first fix here in July: an address for each newsletter, pointed at Readplace instead of your inbox, with [the articles pulled out of every issue](/blog/save-newsletter-links-to-your-readlist?utm_source=blog-read-gmail-newsletters-without-resubscribing&utm_medium=internal&utm_content=post-save-newsletter-links-to-your-readlist). That address still works, now filed under Custom Emails, and it asks for a move. Each subscription has to be re-pointed by hand, and the ones that stayed put kept piling up in Gmail as unread mail.

The Gmail integration drops the move.

> **The subscription stays where it is. The reading moves.**

## The senders come out of your own mailbox

Connecting lives under Integrations in the header, on the row called Newsletters from Gmail. Google's consent screen does the signing in, and Readplace then pages through the mailbox, counting the messages it has checked as it goes, and comes back with a list of the newsletters it found. Choosing one is a search over that list, by name or by address, and a sender already set up drops out of the choices.

There's no form asking for a newsletter's address, because the mailbox already knows it.

## All catches the articles, each list makes its own call

Pick a sender and the next question is where its articles belong. All is in the list and locked, the same catch-all [every save already lands in](/blog/sort-your-saves-into-readlists?utm_source=blog-read-gmail-newsletters-without-resubscribing&utm_medium=internal&utm_content=post-sort-your-saves-into-readlists). Beside it sit your own readlists, as many as fit that newsletter, and the same form creates a new list when none of them does.

What lands in them is not the email. An issue goes through the same sort the newsletter addresses introduced: links that would unsubscribe or confirm on your behalf get set aside untouched, a pass labels what's left, and only the articles come through, crawled and summarized like a link you pasted yourself.

A readlist with a purpose written into its preferences gets a choosier copy. A model reads each article against that purpose and keeps what fits, and a drop from one list still leaves the article in All.

## One filter does the delivery

Gmail only accepts a forwarding address its owner added, so that part stays with you: 4 steps in Gmail's settings, walked through with screenshots on the page. Google then mails a confirmation to the new address, and the address is Readplace's own, so the confirmation handles itself. The page puts it plainly: "Readplace confirms it for you — you never need the code Gmail mentions."

From then on the filter forwards new mail from your chosen senders, and each issue still lands in your inbox the way it did before. The rule sits in Gmail's settings with every other rule, readable and deletable like any of them.

A connected mailbox also gets checked on a 6-hour clock. When an issue arrives from a sender Readplace recognises as a newsletter and you haven't set up, one email goes to your account address, once per sender, so a subscription you forgot about can raise its hand.

## What each Gmail permission is for

Listing senders works from the mailbox's headers, who wrote and when, not from the mail's contents. Managing the forwarding rule takes access to Gmail's settings, and both arrive with the first connection. Reading a message's body is a third permission Readplace asks for only when you start an import: a per-newsletter fetch of the unread issues from the last 30 days, off until its checkbox is ticked, cancellable while it runs. Issues already imported stay in your readlists if you cancel.

The order is the point. Delivery doesn't run on Readplace reading your inbox: Gmail pushes a copy out through the filter, the same mechanism it offers any forwarding address. The deepest permission exists for one bounded job, the 30-day import, not for the everyday path.

## Beta, and easy to leave

Connect Gmail opens a plain disclosure before Google's screen does: the integration is experimental, it only reads your newsletters, and the filter is its one change inside Gmail. The Gmail card carries a Beta chip. Connecting is part of the paid subscription, and a free account sees that stated on the page rather than a button that fails.

Leaving is as plain as arriving. Disconnect Gmail is one button, removing a single sender is one control, and either way the articles already saved stay in your readlists.

## The sender to start with

The newsletter that earns the first mapping is the one you archive out of guilt instead of reading. Connect the account it arrives in under [Integrations](/newsletters?utm_source=blog-read-gmail-newsletters-without-resubscribing&utm_medium=internal&utm_content=newsletters), give it a readlist, and its next issue shows up as articles instead of mail.
