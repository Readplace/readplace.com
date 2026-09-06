---
title: "A Sign-in Page Assumes an Account That Isn't There"
description: "A logged-out reader who tapped Save to My Readlist on a Readplace article used to land on the sign-in page, built for people who already signed up. It routes to signup now, so the newest reader meets a form that has somewhere for them to go, and the saved link still rides through to the readlist."
slug: "save-button-sent-new-readers-to-sign-in"
date: "2026-07-09"
lastModified: "2026-08-24"
author: "Fayner Brack"
keywords: "save article without an account, read it later save before signup, save to read later no account, save a link you were sent, save button sign in vs sign up, save to my readlist readplace, keep a shared article, read it later signup flow, save link route to signup, read it later no account needed"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

One line in the save flow changed, and it sits at the warmest step in the funnel. A logged-out visitor reading a Readplace article taps Save to My Readlist. Until now that tap sent them to `/login`, the sign-in page, which asks for an email and password on an account they never made. It goes to `/signup` now. The article's address rides along in a `return` parameter through either page, so the save still finishes the second the account exists. A returning reader who lands on signup by mistake is one link from sign-in, article address intact, so nobody is stranded either way. The redirect just stopped defaulting the newest reader onto the one page built for people who already left.

</div>
</details>

A sign-in page is built for people who already have an account. A signup page is built for the ones who don't.

For months, the button a logged-out reader tapped to keep a Readplace article sent them to the first one.

## The button on a page you don't own yet

Readplace serves a clean reader view of an article at a public address, the kind of link you can [send to anyone and have the preview come out clean](/blog/share-a-clean-article-link?utm_source=blog-save-button-sent-new-readers-to-sign-in&utm_medium=internal&utm_content=post-share-a-clean-article-link). Open one and the article is there, stripped to text, no login asked for. Next to it sits a button, Save to My Readlist. For a first-time visitor that button is the whole point of the page: read the clean copy, decide you want it, and put it in a readlist of your own.

The visitor tapping it is the warmest one Readplace gets. They are not skimming a marketing page. They are inside the product, reading a real article on it, reaching for the save.

Tap it while logged out and Readplace sent you to `/login`. Two fields, an email and a password, for an account you never made, because you do not have one here yet.

> **The reader most ready to join was handed the page for people who already had.**

## One word in the redirect

The save route does a plain thing. Signed in, it drops the link into your readlist. Signed out, it sends you off to become signed in, and it tucks the article's address into a `return` parameter so you come back to the save once you are through.

That somewhere was `/login`. The fix points it at `/signup`. One word.

The `return` value rides through either page unchanged, so nothing downstream moved. Make the account, and the flow hands you back to the article with it already saved. The mechanics held still. The door the visitor walks up to is the only thing that changed.

A tell had been sitting in the code the whole time. The event Readplace logs at that exact step, the one marking the warmest funnel moment, was already named `promptedToSignUp`. So the analytics called it a signup prompt, while the redirect sent the reader to sign-in. The name knew where they belonged before the redirect did.

## A sign-in form is a wall with no gate for a stranger

A sign-in form is a checkpoint. It asks you to prove you are someone it already knows. For a returning reader that is right, and quick. For a first-timer it is a wall with no gate, because the thing it checks for, an account, is the one thing they do not have.

There is a small link near the bottom, create one. They have to notice it, read it, and click through, after the page has told them in so many words that they are in the wrong place. Every one of those is a step where a warm reader cools off and closes the tab. The same reasoning [moved the signup form to the end of the import flow](/blog/import-links-before-signing-up?utm_source=blog-save-button-sent-new-readers-to-sign-in&utm_medium=internal&utm_content=post-import-links-before-signing-up) and [put the importer itself in front of the account](/blog/import-page-findable-in-search?utm_source=blog-save-button-sent-new-readers-to-sign-in&utm_medium=internal&utm_content=post-import-page-findable-in-search). Ask for the account when the person is ready to make one, not before they have seen a reason to.

The signup page keeps the door open the other way too. It carries an Already have an account? Sign in link, and that link holds the same `return` value. So a returning reader who lands on signup by accident is one click from the login form, article address still attached, and finishes the save just the same. Neither reader is left stuck. The default just matches who turns up more often at that button: someone new.

> **The redirect points at the page built for the person most likely to be standing in front of it.**

## Where the click lands now

Where a logged-out tap on Save to My Readlist goes changed, and only that. It heads to signup. A signed-in tap still drops straight into the readlist. A reader who reached signup by mistake takes one link back to sign-in with the article address riding along. Each path ends with the piece saved.

This is not a new feature. It is a one-word change to where a button points. It just happens to sit at the warmest step in the whole flow, the moment a reader who came in on a shared link decides they want a copy of their own, and [a copy that outlasts the page it came from](/blog/saved-articles-outlast-the-original-page?utm_source=blog-save-button-sent-new-readers-to-sign-in&utm_medium=internal&utm_content=post-saved-articles-outlast-the-original-page).

Getting a reader to want the thing is the hard part. Sending them to a page that can say yes is the easy part, and it was worth stopping to get right.

Send yourself a Readplace article, open it logged out, and reach for Save to My Readlist to walk the path a new reader walks. A readlist of your own starts at [readplace.com](/?utm_source=blog-save-button-sent-new-readers-to-sign-in&utm_medium=internal&utm_content=home) or from [the browser extension](https://readplace.com/install).
