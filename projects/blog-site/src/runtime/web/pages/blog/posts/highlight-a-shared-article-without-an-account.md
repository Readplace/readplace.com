---
title: "Highlight a shared article without an account"
description: "Shared Readplace article pages now show the highlight toolbar signed out. Up to 5 highlights with their notes live in the browser alone, and creating an account or logging in moves them in, with the article saved alongside."
excerpt: "The highlight toolbar stopped checking for an account. The first 5 marks belong to the browser."
tldr: "Up to 5 highlights can now be made on a shared article page with no account behind them. Readplace draws each mark in the browser, lists it in a Highlights card, and keeps it in that browser alone. Creating an account or logging in hands the marks to the server first, because finishing either wipes the browser's stored data, and the new account starts with the article saved and every mark and note on it. The 6th highlight, or a passage or note over 1,000 characters, is where the popup asks for an account."
slug: "highlight-a-shared-article-without-an-account"
date: "2026-11-18"
author: "Fayner Brack"
keywords: "highlight articles without an account, highlight a shared article, web highlighter no sign up, annotate an article before signing up, keep highlights after signing up, logged out highlights, read it later app with highlights, pocket alternative with highlights, readplace"
---

5 highlights now fit in a browser with no account behind it.

A shared Readplace link opens [the saved copy of the article](/blog/share-a-clean-article-link?utm_source=blog-highlight-a-shared-article-without-an-account&utm_medium=internal&utm_content=post-share-a-clean-article-link), and the visitor who follows one is usually signed out. For that visitor the highlight toolbar used to stay hidden, so selecting a passage did nothing. Now the toolbar appears, and Highlight draws a mark that stays.

The first 5 are kept with no questions asked. The 6th is where the account comes up.

## The same toolbar, signed out

Select a passage and the toolbar offers Highlight and Add note, the pair signed-in readers already have. On a phone, tapping a sentence selects the whole sentence, so there are no selection handles to drag across the quote.

Each mark is also listed in a Highlights card beside the article, labelled plainly: "Kept in this browser only. Up to 5." Marks made on other shared articles sit in the same card, each with a Delete, so a spent slot can be freed without finding the page it was spent on.

## 5 marks, held by the browser alone

The marks live in the browser's own storage. The server holds no copy, and clearing the browser's site data clears them with it.

Readplace learns they exist only when their owner decides they're worth an account.

The budget is 5 across all articles, not 5 per article. A single passage or note runs to 1,000 characters, which covers most quotes worth keeping and most thoughts about them.

## What the 6th mark opens

Trying for a 6th opens a small popup titled "Keep your highlights": "This browser keeps up to 5 highlights. Create a free account to keep them and add as many as you like." Under the sentence sit Create a free account, Log in, and Not now.

Not now means that. The popup closes, the 5 stay marked, and nothing nags on a timer. A passage or note past the 1,000 characters gets the same popup with one more line, saying a longer one needs an account.

## Sign-up wipes the browser, so the marks leave first

The part worth explaining is how 5 marks survive the sign-up. Finishing a sign-up or a log-in makes Readplace send `Clear-Site-Data: "storage"`, a header that tells the browser to clear what the site stored there, and that guard predates this feature.

Marks that waited in the browser would not live through their own rescue.

> **So the handover runs backwards: the marks go to the server before the account exists.**

Pressing Create a free account posts the 5 to Readplace, which holds them for 24 hours behind a cookie only that browser carries, then opens the sign-up form. Once the account is made, a step titled "Keep your highlights" adds them to it and submits itself.

The article lands saved on the new account, and each mark is recreated from its quote, the exact words plus the text around them, [the way every highlight here is stored](/blog/highlights-find-their-sentence-again?utm_source=blog-highlight-a-shared-article-without-an-account&utm_medium=internal&utm_content=post-highlights-find-their-sentence-again). The character positions the browser measured are discarded rather than trusted.

The Save button on a shared page, the save form under the article and the Log in link all hand the marks over the same way before the account pages load, so saving the article doesn't cost the marks either. A handover that no sign-up follows expires: after 24 hours the server's copy can no longer be claimed and is deleted, which [the privacy page](/privacy?utm_source=blog-highlight-a-shared-article-without-an-account&utm_medium=internal&utm_content=privacy) spells out.

## The line that made someone share it

A link that arrives in a group chat tends to have one passage doing the arguing. Open the link, find that passage, and the toolbar is already there.

The account can wait for the 6th mark, and when the 6th comes, signing up at [readplace.com](/?utm_source=blog-highlight-a-shared-article-without-an-account&utm_medium=internal&utm_content=home) brings the first 5 along.
