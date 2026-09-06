---
title: "An Empty Readlist Is a Bad First Impression"
description: "A brand-new reading account used to open on nothing, the article that talked the reader into signing up already gone. Readplace now holds that article on the logged-out reader for two hours and, if you sign up in that window, saves it into the new readlist before you add a thing."
slug: "your-first-article-is-already-saved"
date: "2026-07-19"
author: "Fayner Brack"
keywords: "read it later empty readlist, save the article you were reading, read it later onboarding, new account first article, save article before signing up, read it later no empty start, keep the article that made you sign up, read it later sign up google apple, first save read it later, save what you read logged out"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

An empty readlist is the least convincing thing a new reading account can show, and it's the first thing most apps hand a new reader. The article that talked them into signing up is already gone from it. Readplace carries that article across instead. Read a piece in the logged-out reader and Readplace holds its address in a short-lived cookie, good for two hours. Sign up inside that window with Google or Apple and the signup routes you through a save, so the article lands in your new readlist before you add a single thing yourself. The cookie is read and cleared in one step, so it saves exactly once, and a later signup on the same browser can't inherit an earlier reader's article. The held address is re-validated with the same check every save runs, so a tampered cookie saves nothing. An explicit save you began before signing up still wins, so the piece you meant to keep never doubles. A new account opens on the thing that brought you, not a blank page.

</div>
</details>

Readers usually arrive at Readplace already reading. Someone shares a clean link, a logged-out stranger opens it in the reader, gets to the end, and decides they want copies of their own.

The old signup let that first article slip. A new reader finished the piece, made an account, and landed on an empty readlist, the very thing they'd just read nowhere in it.

It carries across now. Read something logged out, sign up in the next couple of hours, and that article is already saved when the readlist loads.

## The blank first screen

A read-it-later readlist with nothing in it is a hard thing to look at. There's nothing to open, and nothing that shows what the app looks like once your reading is in it. The one article that made the case for an account is the obvious thing to put there first, and it's the one thing the old flow dropped.

Getting it back was manual. You'd go back to wherever the link was, copy it again, return, paste it, and wait for the save.

That's a few minutes of work to recover something you had a moment ago. Most people don't do it. They close the tab on an empty readlist and the account starts cold.

> **The article that earns the signup is the one thing worth showing first, and it was the one thing the old flow let go.**

## How the read comes with you

When you open an article in the logged-out reader, Readplace writes the address into a cookie set to last two hours. That's the whole memory of it, one address, held on your browser for as long as it takes to finish a piece and decide.

Sign up inside that window and the signup reads the cookie back. Rather than drop you on the readlist, it sends you through a save first, the same save any article takes, so the piece you were reading is submitted the instant the account exists. The readlist you land on has one article in it, the right one.

Two hours is the ceiling on purpose. It's long enough to read a piece and think it over, short enough that an address you looked at this morning can't attach itself to a signup tonight. A read you walked away from expires on its own.

## Saved once, and only what you read

An address held on a browser could be wrong, stale, or tampered with, so three checks sit around it.

The cookie is read and cleared in the same step. Consuming it that way means it can save exactly once. Without the clear, a second person signing up on a shared browser inside the two hours would inherit the first reader's article, so the read is spent the moment it's used.

The held address runs through the same validator every save uses before it reaches the readlist. A cookie edited by hand to point somewhere it shouldn't fails that check and saves nothing. The auto-save can't reach a page a normal save couldn't.

An explicit save wins over the read. If you tapped Save on an article before signing up, that piece is already riding through the signup in its own return path, [the flow that stopped sending new readers to a sign-in page](/blog/save-button-sent-new-readers-to-sign-in?utm_source=blog-your-first-article-is-already-saved&utm_medium=internal&utm_content=post-save-button-sent-new-readers-to-sign-in). The auto-save stands down in that case, so the article you meant to keep is saved once, not twice.

```rp-figure
kind: rule
title: Whether the article you read logged out lands in the new readlist
note: Three checks sit around the held address, and the two-hour ceiling sits over all of them.
choice: When you sign up after reading | Straight away | Inside the two hours | Tonight, after a morning read
flag: I tapped Save on the article before signing up
flag: The cookie was edited by hand to point somewhere it shouldn't
flag: Someone else on this shared browser already signed up on this read
when: f1 -> ok | Saved once | An explicit save wins over the read, so the auto-save stands down and the article you meant to keep is saved once, not twice.
when: f2 -> no | Nothing saved | The held address runs through the same validator every save uses, and a cookie edited by hand fails that check.
when: f3 -> no | Spent | The cookie is read and cleared in the same step, so the read is spent the moment it's used and a later signup can't inherit an earlier reader's article.
when: c1=3 -> no | Expired | Two hours is the ceiling on purpose, so an address you looked at this morning can't attach itself to a signup tonight.
else: ok | Saved | The signup reads the cookie back and sends you through a save first, so the readlist you land on has one article in it, the right one.
```

## The first minute of an account

The first minute inside a new account is where a reader decides whether the thing is for them. An empty readlist answers that badly. It asks them to go find something to save before the app does anything worth seeing, at the moment their patience is thinnest.

A readlist that opens on the article they were just reading answers the other way. The app has already done the thing it's for, on a piece they picked themselves, before they lifted a finger. Whether the rest earns a place is still theirs to judge, and now they're judging it with their own reading on the screen instead of a blank one.

This only reaches a reader who came in through the reader itself, logged out, [where any article opens without an account](/blog/read-any-article-clean-reader?utm_source=blog-your-first-article-is-already-saved&utm_medium=internal&utm_content=post-read-any-article-clean-reader). That's a common way in. A shared link is how a lot of people meet Readplace, and it catches them at the one moment they've already shown what they want to read.

> **A new account should open on something the reader chose, not on the work of finding something to save.**

## Read one before you sign up

To see it work, come in the way a new reader does. Open any article in the reader without signing in, read a little of it, then make an account with Google or Apple. The piece is waiting in the readlist when it loads.

If you already have an account, open a shared reader link in a browser you're signed out of and watch it happen there. The article you read is [held past the day the live page moves on](/blog/saved-articles-outlast-the-original-page?utm_source=blog-your-first-article-is-already-saved&utm_medium=internal&utm_content=post-saved-articles-outlast-the-original-page) either way, which is the reason to save it at all. Start a readlist at [readplace.com](/?utm_source=blog-your-first-article-is-already-saved&utm_medium=internal&utm_content=home) or add [the browser extension](https://readplace.com/install), and the first thing you read logged out is the first thing it keeps.
