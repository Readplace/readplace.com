---
title: "Introducing GMail integration"
description: "A newsletter you chose arrives in Gmail between a receipt and a calendar invite, and gets cleared with the rest. Connect Gmail to Readplace, point a sender at a readlist, and each new issue lands there as saved articles, summarized and sorted out from the packaging. The subscription keeps its address, the mail stays unread, and connecting reads mail headers, not mail."
slug: "introducing-gmail-integration"
date: "2026-10-03"
author: "Fayner Brack"
keywords: "gmail integration, read gmail newsletters, gmail newsletter reader, save newsletters to read later, newsletter to read it later app, connect gmail to read it later, newsletter overload, gmail newsletters to readlist, readplace"
tags: ["changelog"]
banner: "The newsletters in your Gmail can fill a readlist"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Week after week, the newsletters you chose lose to the email you didn't. Readplace now connects to Gmail: pick a sender, point it at a readlist, and each new issue lands there as saved articles, sorted out from the sponsor slots and the unsubscribe footer. The subscription keeps its address, and the mail stays in Gmail, unread and unmoved. The connection comes with a paid Readplace subscription, reads mail headers, not the mail itself, and permission to read arrives only if you ask for the unread issues of the last 30 days, one sender at a time.

</div>
</details>

The mailbox is a machine for clearing, and a falling count is what a good day there looks like. A newsletter asks for the opposite of clearing, 20 unhurried minutes, and it arrives in the middle of the clearing anyway, between a receipt and a calendar invite.

The subscription was a decision about reading. The mailbox files it under mail to get through.

Readplace's first answer shipped in July: [an address you hand one newsletter](/blog/save-newsletter-links-to-your-readlist?utm_source=blog-introducing-gmail-integration&utm_medium=internal&utm_content=post-save-newsletter-links-to-your-readlist), so the issues skip your mail entirely. That answer stands, and it asks for a trade. Each subscription has to move to its new address through one publisher's preferences page at a time, and the subscriptions that don't get moved keep landing where they did before.

The trade is what this week removes. The newsletters already arriving in a Gmail account can now feed readlists directly, with nothing re-subscribed and nothing moved.

## One pasted address, confirmed on its own

Connecting lives under Newsletters, the nav item that now holds both ways in: From Gmail, and the July addresses as From Custom Emails. On the From Gmail page, step 1 is a Google sign-in. Step 2 is the one manual piece of the whole setup: Gmail's settings page takes [a forwarding address](/view/support.google.com/mail/answer/10957?utm_source=blog-introducing-gmail-integration&utm_medium=internal&utm_content=read-support-google-com), and the page shows the exact address to paste, with screenshots for where it goes.

Gmail responds to a new forwarding address by emailing a confirmation to that address. The address belongs to Readplace, so the confirmation is handled the moment it arrives. In the page's own words: "Readplace confirms it for you — you never need the code Gmail mentions."

After that, the rest of the feature is a menu with 2 pickers in it.

## A sender becomes a readlist

Load senders, and Readplace builds the list from the mailbox itself, working back through the most recent messages, about 5,000 of them. A sender the shared catalog recognises appears under its newsletter's name, JavaScript Weekly rather than jsw@peterc.org, and a sender it doesn't know yet maps the same way. One picker takes the newsletter, the other takes the readlist, and a readlist that doesn't exist yet can be created inside the picker.

Save, and Readplace writes the filter into Gmail. New mail from that sender forwards over, and the subscription is none the wiser.

Each forwarded issue then goes through the same sorting the July addresses run. A link that would unsubscribe or confirm is set aside without being opened, a pass labels what remains, and only the articles reach the readlist, crawled for a clean copy and summarized. The sponsor slots and the section menus stay behind with the email.

## Headers now, reading only on request

The connection asks Google for 2 permissions, and neither reads mail. One manages Gmail settings, which is what writes the forwarding filter. The other reads message headers, the sender, subject and date lines, which is what builds the sender list. Message bodies don't travel through either scope, and that boundary is Google's to enforce rather than Readplace's to promise.

> **Connecting shows Readplace who writes to you, not what they wrote.**

A fresh mapping offers one exception, off until ticked: "Import unread messages from the last 30 days". Ticking it goes back to Google, which asks this time about reading, and the import that follows reads mail from that one sender and leaves every message unread. An issue that arrives twice, once forwarded and once imported, saves once: each one is claimed by its Message-ID.

## Gmail stays as it was

Forwarding copies. The issues keep arriving in Gmail, unread state intact, at the address the subscription was made with years ago. Readplace archives nothing there and marks nothing read.

Removing a mapping stops the forwarding for that sender and keeps what was already saved. The notice on the page commits to it: "Mapping removed. Articles you already saved stay in your readlists."

## A month of backlog on day 1

The 30-day import makes the first mapping a fair test instead of a week of waiting. Pick the sender whose issues stack up fastest and give it a readlist of its own. Tick the import. The backlog comes back as summarized articles, which is an easier thing to face than a month of unread mail from the same sender.

Connecting Gmail takes an active paid Readplace subscription, and the setup itself is a sign-in and one pasted address, under [Newsletters](/newsletters?utm_source=blog-introducing-gmail-integration&utm_medium=internal&utm_content=newsletters) at [readplace.com](/?utm_source=blog-introducing-gmail-integration&utm_medium=internal&utm_content=home). The next issue is coming either way. Where it lands just became a choice.
