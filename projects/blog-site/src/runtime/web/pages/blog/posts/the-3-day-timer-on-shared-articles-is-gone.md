---
title: "The 3-Day Timer on Shared Articles Is Gone"
description: "Send someone a link to an article you saved and, 3 days after that article's last save, the page used to cover itself with a 'Public access expired' dialog. The dialog is deleted. A shared reader page now stays open for good, the countdown went with it, and a share link no longer carries a code naming who shared it."
slug: "the-3-day-timer-on-shared-articles-is-gone"
date: "2026-08-25"
author: "Fayner Brack"
keywords: "share saved articles, shared article link expired, public reader page, read shared link without account, no sign in wall, share articles from read it later, link rot, pocket alternative sharing, readplace"
tags: ["changelog"]
banner: "I took the 3-day timer off every shared article link"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

A link shared from Readplace used to stop working. 3 days after the article's last save, the public page covered itself with a dialog reading "Public access expired" and asked the visitor to sign in before they could finish. That wall is removed outright: Readplace now keeps a public reader page open for good, whatever the article's length and the age of the link. The live countdown went with it, and so did the code a share link carried to name who shared it. The wall existed to nudge visitors into signing up for a copy of their own. Set against the reads it ended, it was costing more signups than it earned.

</div>
</details>

The sign-in wall on Readplace's shared article pages retreated twice before it came down, and each retreat had conceded the same point.

For 3 days after an article's last save, its public page stayed open to anybody holding the link. Then a dialog covered the text: public access expired, sign in to save your own copy and finish reading. That dialog is deleted. A page somebody shares now stays readable for good, on any article, whatever the age of the link, with no account asked of the person opening it.

## A wall already in retreat

The reasoning behind the wall was ordinary. A page that won't stay open gives a visitor a reason to sign up and keep a copy while they can. The public reader page is where a stranger first meets the product, so the wall doubled as the pitch.

It gave ground the first time in July, after a complaint that stuck with me: a reader sent to a sign-in page just to reach the end of a short Jeff Atwood post. The fix read the article's estimated reading time and left anything of 5 minutes or under open with no clock.

Subscribers had an exemption of their own. A share link carried a small code naming its sharer, so the page could look up the subscription behind the link and hold the wall back. More on that code below, because deleting it is my favourite part of this change.

Each exemption admitted that the wall stood in front of the wrong person. Removing it outright is the same admission, made once instead of piecemeal.

## The visitor it was charging

The person who opens a shared link is often meeting Readplace for the first time, and they arrived because somebody they know vouched for one specific article. A reading app doesn't get a warmer introduction than that.

The wall ended exactly those visits. It rarely fired on the day a link was sent, because the clock allowed 3 days. It fired when the link resurfaced in a group chat the following week, or when a search engine handed the page to a stranger a month on. The recommendation kept circulating after the page behind it had stopped answering.

> **A shared article is a recommendation, and the wall was billing the person who received it.**

The wall existed to buy signups, and the judgement behind removing it is that it cost more than it bought. A visitor who bounces off an expired recommendation doesn't circle back to open an account, and a sharer whose links keep dying stops sharing. TBH there is no A/B test behind that call. It is the Jeff Atwood complaint taken at its word, applied to every link instead of the short ones: the wall charged a toll at the exact moment somebody was doing my marketing for me.

## The code that named the sharer

Holding the wall back for subscribers took machinery. Every share link got stamped with a 6-character code, a prefix of the sharer's account id, tucked into the link's tracking tag. The public page read the code, looked up the account, and checked for a subscription. A database index existed for that lookup alone.

With no wall to hold back, the code answers no question. The share button no longer stamps it, the index is deleted, and a link you pass on now names the article and nothing about who sent it.

The rest of the furniture went in the same commit: the live countdown, the script that blurred the text under the dialog, and the expiry warning that sat beside the save buttons. The July post explaining the 5-minute rule came down too, so its address now answers with a 404 instead of a rule that no longer runs.

## The link from July opens today

There is no grace period behind this, because there is no check left to be graceful about. A link that hit the dialog in July answers with the article now. One shared next year opens the same way.

Your own saved copy was on no clock before and is on none now, and [a save outlasts the page it came from](/blog/saved-articles-outlast-the-original-page). The clock lived only on the public page, and the public page no longer keeps one.

So the next article worth passing on can go out without a glance at the calendar. It opens whole, in [the same clean reader](/blog/read-any-article-clean-reader) a queue shows, and [readplace.com](/) sits under it if the person reading decides they want a pile of their own.
