---
title: "A Confirm Dialog Is Not a Guard"
description: "Deleting a Readplace account removes the account, every saved article, and the reading history behind it, with no undo. That button used to take one tap on OK. It now takes a phrase you type by hand, checked on the server, so the door out stays yours to open on purpose."
slug: "delete-your-account-with-a-typed-phrase"
date: "2026-07-11"
author: "Fayner Brack"
keywords: "delete readplace account, delete read it later account, self-serve account deletion, type to confirm account deletion, delete account confirmation phrase, own your reading data, read it later delete my data, delete saved articles, confirm dialog delete account, leave a read it later app"
tags: ["changelog"]
banner: "I made deleting an account a thing you type out by hand"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Deleting your Readplace account removes the account, every saved article, and your reading history, with no trash and no undo behind it. The old guard on that button was the browser's own confirm box, one tap on OK, the same two taps whether you meant it or mis-scrolled into it. The control now asks you to type a phrase by hand, "delete my account permanently", four words matched exactly. The field checks itself in the browser, but the guard that counts sits on the delete route: the server reads the field again and refuses any value that isn't the exact phrase, redirecting back with a notice that your account was not deleted. The same release made deletion self-serve, so it ends your sessions, revokes the tokens behind a Google or Apple sign-in, and clears your data without a person in the loop, on both the web and the iPhone app. You own the way out, and opening it takes a deliberate act instead of a reflex.

</div>
</details>

Four words now stand between a Readplace account and the end of it: delete my account permanently, typed into the box by hand.

The button used to take one tap on OK, which is no guard at all on something you can't undo.

## The tap you have already made

Most confirm boxes guard something you can redo. Close a tab, or leave a page with edits you did not save. Press the wrong button and the cost is a minute, so the box is a speed bump and little else. OK sits where OK usually sits, and after enough of them the hand goes there on its own, before the sentence in the middle gets read.

The delete-account control is not that kind of button. It removes the account, every saved article, and the reading history tied to it. There is no trash to fish it back out of, and no 30-day hold. A guard a trained reflex clears in one tap is not standing in front of much.

## What one tap used to be enough for

The old danger zone worked the way most of the web does. You pressed Delete, the browser raised its own confirm box, and one more tap on OK finished it. Two taps, both in the same spot, both muscle memory.

The person who meant to delete and the person who mis-scrolled into the button made the exact same two taps. The dialog could not tell them apart, because it asked for nothing that only the first person would do.

## The phrase the button now costs

The danger zone now asks you to type a sentence out. The field label reads: type "delete my account permanently" to confirm. Four words, entered by hand, matched exactly. An empty box, or a near-miss, sends nothing through.

Typing that phrase is not a thing a thumb does by accident. It takes reading the label, moving to the field, and spelling out four deliberate words. The effort is small, and it is the point. It costs about the amount of attention the thing behind the button is worth.

## Why the check lives on the server

A typed field can check itself in the browser. The input carries a pattern, so a mismatch shows an error before the browser sends anything. That part is a courtesy to the person who fat-fingered a letter, and it stays on the page.

The guard that counts is on the server. The delete route reads the field again and compares it to the phrase, and anything short of an exact match deletes nothing. It redirects back to the account page with a plain notice: your account was not deleted, type the phrase exactly to confirm. A request that skips the page and posts straight to the route still has to carry the right four words, or it goes nowhere.

> **A check in the browser is a courtesy. A check on the server is the thing that actually holds.**

## Leaving is yours to do

The same release made deletion self-serve. Removing an account used to mean sending an email and waiting on someone to act on it. The control sits on your own account page now, and it runs on its own. It ends your sessions, revokes the tokens behind a Google or Apple sign-in, and clears your data with no person in the loop.

Apple's [App Store rules](/view/developer.apple.com/app-store/review/guidelines/) ask an app that lets you make an account to let you delete it too, and one route answers both the web and the iPhone app. On the app, a rejected phrase re-renders the account page without any of its subscribe controls, so a mistyped word does not bounce you into a screen asking for money.

Being able to leave on your own terms is part of trusting a place with your reading. The archive earns its keep by [outlasting the pages it copied](/blog/saved-articles-outlast-the-original-page). That holds only if the way out is yours to take, and if taking it is a thing you do on purpose rather than by a stray tap.

## Where the phrase waits

The delete control sits at the bottom of your account page, under a heading marked Danger zone, four typed words from the end of the account. If you don't have a reading queue to guard yet, one starts at [readplace.com](/) or with [the browser extension](https://readplace.com/install).
