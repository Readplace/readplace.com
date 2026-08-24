---
title: "The Sign-In Wall on Shared Articles Is Gone"
description: "Send a saved article to someone without an account and, 3 days after its last save, a blur used to cover the page under a dialog asking them to sign in. The wall kept growing exemptions until the default was the odd case out, so I deleted it. A shared Readplace link now opens the whole article whenever it gets opened, with no countdown and no account asked."
slug: "the-sign-in-wall-on-shared-articles-is-gone"
date: "2026-08-24"
author: "Fayner Brack"
keywords: "read a shared article without signing in, share saved articles no account, public article reader page, sign in wall removed, expiring share links, share a read it later link no signup, read shared link without account, link rot, clean reader share link, pocket alternative sharing"
tags: ["changelog"]
banner: "I took the sign-in wall off every shared article page"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

The sign-in wall that dropped over a shared article 3 days after its last save is gone. A link that leaves Readplace now opens the whole article whenever it gets opened, with no countdown under it and no account asked of the person reading. The wall had spent a month growing exemptions: short reads were already exempt, and so were subscribers' share links and visitors from my own blog. I read that list as the verdict it was and removed the wall outright. The copy in your own queue wasn't the thing on a clock, and it still isn't.

</div>
</details>

Walling off a shared page is supposed to be a trade. The visitor pays with an account and the product collects a signup. Readplace ran that trade on its public reader pages, and for a month I kept finding reasons to let people around the wall. This week I stopped patching it and deleted it.

## 3 days, then a blur

A saved article has a public address: the [clean reader page](/blog/read-any-article-clean-reader) a shared link opens. That page carried a clock, set to 3 days after the article's last save.

While the clock ran, a counter ticked it down by the second, "Public access will expire in 2d 3h 14m 9s". Once it ran out, a reader who scrolled 10% into the article got the text below their reading line blurred, with a dialog on top. "Public access expired. Sign in to save it to your queue and read the whole article in reader view."

The dialog was polite. One button offered the article on its original site, the other offered a save. It was still a wall, standing 2 screens into a page somebody had vouched for by sending it.

## The exemption list

The retreat started with a complaint: a reader sent to a sign-in page on the way to a Jeff Atwood post. The fix, shipped in July, read the estimated reading time before deciding anything, and a piece at 5 minutes or under stayed open with no clock at all.

Other doors were already open or opened soon after. A visitor arriving from my own blog skipped the wall, since that blog links to reader pages on purpose. A link shared by a paying subscriber skipped it through real machinery: the share link carried a 6-character code naming its sharer, the page turned the code back into an account, and an active subscription took the clock off. A database index existed for that lookup alone.

> **A rule that keeps growing exemptions is telling you what its default should have been.**

Each carve-out was written as a refinement. Read together they were a verdict. Wherever a case got a close look, the wall lost, and what stayed walled was whatever hadn't drawn a complaint yet.

The July post here argued the remaining window was a fair trade on long reads, and I believed it when I wrote it. But the wall met a stranger mid-article, at the moment their interest in this product was highest, and asked for a commitment before the last screen. A shared link is how a stranger first meets Readplace. My reading, a month later: the wall cost more signups than it earned, on top of the readers it cost.

So it came down for the rest of the cases too, the long reads included.

## Deleted along with the dialog

The removal reached past the dialog. The countdown client is gone, and the expiry line in the save rail. The blur went with them, along with the event it fired so the share balloon could get out of the dialog's way.

The sharer machinery went too. With no wall to bypass, nothing reads the 6-character code, so share links stopped stamping their sharer into the tracking parameter, and the database index that resolved the code is deleted. A perk built to soften a wall doesn't outlive the wall.

The July post came down with it. It documented a page that no longer exists, so rather than correcting it I removed it, and its address now answers 404.

## A link you can send without a caveat

What a shared link opens now is the article, all of it, this week or next year, in the same clean reader. The save button stays beside the text for anyone who wants a copy of their own, and with no deadline behind it, it reads as an invitation. The clock only ever lived on this public page. The copy in your own queue wasn't on it, and still isn't.

Send the best thing you saved this month to someone with no account, without the "open it soon" that used to belong in the message. The page is theirs to read whenever they get to it, and the queue it came out of is waiting at [readplace.com](/) if they decide they want one.
