---
title: "A Short Read Shouldn't Ask You to Sign In"
description: "Share a link to a short article and the person who opens it can read the whole thing with no account. Readplace now checks the estimated reading time before its public reader page ever shows a sign-in wall, so a piece you can finish in one sitting stays open for good."
slug: "read-a-short-article-without-signing-in"
date: "2026-07-25"
author: "Fayner Brack"
keywords: "read a shared article without signing in, read it later without an account, read the whole article no sign in, public article reader page, share a read it later link no signup, open a saved article link without an account, read article free no login, read shared link without account, no sign in wall short article, read it later share a clean link"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

A link that gets shared or turns up in a search lands a reader on Readplace's public reader page for that article. The page used to stay open for 3 days after the article's most recent save, then show a wall asking the visitor to sign in and save their own copy. For a long report that trade is fair, since it's the kind of thing you keep to finish later. For a 5-minute post it read as a sign-in wall bolted onto something you could finish on the spot. Readplace now reads the estimated reading time before it decides. Anything that takes 5 minutes or less stays public with no expiry, so a short piece someone shared is open whenever the link is opened, no account asked for. Longer articles keep the few-day window that nudges a reader to save a copy of their own. Readers arriving from the founder's blog skip the wall whatever the length, because that traffic is a syndication channel, not a lead to gate. Your own saved copy was never on the clock and still isn't. What changed is the page a stranger meets, where a quick read no longer costs a login.

</div>
</details>

A read-it-later app is organized around one word: later. The report you'll open on the weekend, the longread you clipped at lunch and haven't touched since.

A public reader page meets a different visitor. The link was shared, or it turned up in a search, and the person reading it is here now. A lot of what they open is short.

A short read has no business sending that person to a sign-in page before the last paragraph. Readplace used to send them anyway. This week it stopped.

## The page a stranger meets

Save an article and you get a private copy in your queue. You also get a public address for it, the reader view, the thing a shared link points at. [Open a shared Readplace link](/blog/read-any-article-clean-reader) and you land there, in the clean copy, with no account in the way.

That public page carried a clock. It stayed open for 3 days after the article was last saved, and once the window passed it showed a small wall: public access expired, sign in to save it and read the whole article. The idea behind it was ordinary. A page that won't sit open forever gives a visitor a reason to keep their own copy while they can.

For a long article, that holds up. A 40-minute report is the kind of thing a reader wants a copy of, and a few days is room enough to decide.

For a 5-minute post it fell apart. Someone shares a link to a short piece, you open it, read two screens, and a wall stands between you and the last one, asking you to make an account to finish something you could have read in the time the wall took. The objection that pushed the change was plain: being sent to a sign-in page just to reach the end of a short blog post.

> **The clock only ever lived on the page a visitor sees before they have saved anything.**

## Reading time decides

The fix is small. Before the page works out whether to show the wall, it reads the article's estimated reading time, the same figure that sits at the top of every saved copy.

If the read comes in at 5 minutes or under, the page never expires. No clock, no wall, on the strength of nothing but the piece being short. A post someone shares today is open the day they share it and open a year later.

Past 5 minutes, the few-day window stays. Those are the articles a reader is more likely to want saved than finished on the spot, so the nudge to keep a copy still fits them. The line runs at the reading time, not at whatever the page happens to be about.

> **A read you can finish in one sitting shouldn't cost a login to reach the end.**

One group skips the wall no matter the length. A reader who arrives from the founder's blog never meets it. That blog links out to these reader pages on purpose, and gating the readers it sends over would work against the reason the link is there. Where a reader came from can waive the wall the same way a short read does.

## Your copy was never the one on the clock

It's worth being clear about what did and didn't have an expiry. Your own saved articles never expired, and they still don't. [A copy you saved outlasts the page you took it from](/blog/saved-articles-outlast-the-original-page), with no window on it at all. The clock lived only on the public page a visitor sees before they sign up.

```rp-figure
kind: rule
title: What decides whether a reader meets the sign-in wall
note: The clock only ever lived on the page a visitor sees before they have saved anything.
choice: Reading time | 5 min | 40 min
choice: Since the article was last saved | within 3 days | past 3 days
flag: The reader arrived from the founder's blog
flag: It is my own saved copy
when: f2 -> ok | Open | Your own saved articles never expired, and they still don't.
when: f1 -> ok | Open | A reader who arrives from the founder's blog never meets the wall, no matter the length.
when: c1=1 -> ok | Open | 5 minutes or under and the page never expires. No clock, no wall.
when: c2=1 -> ok | Open | Past 5 minutes the few-day window stays, and this page is still inside the 3 days after the last save.
else: no | Wall | Once the window passes the page shows a small wall: public access expired, sign in to save it and read the whole article.
```

So the change moves in one direction. It takes the wall off the person who hasn't signed up yet, on the exact reads where the wall bought nothing. A stranger who lands on a short article reads it start to finish and judges the rest for themselves, instead of stopping two screens in.

A sign-in wall on a long report is a reasonable trade. A sign-in wall on a five-minute read is a toll charged on something that was never worth charging for.

Send a short article you saved to someone who has never used Readplace. They can read every word of it without an account, and the [reader that opens it](/blog/read-any-article-clean-reader) is the same one waiting at [readplace.com](/) if they decide to keep their own.
