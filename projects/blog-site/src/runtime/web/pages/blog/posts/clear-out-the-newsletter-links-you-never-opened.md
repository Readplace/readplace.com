---
title: "Clear out the newsletter links you never opened"
description: "All keeps every link a newsletter saves, and the unread ones pile up. The Newsletter Links Removal page counts them, shows which newsletters sent the most, and removes only the untouched links in one pass. Issues and readlist copies stay, and each removed link can be restored for 30 days."
excerpt: "One pass clears the unread newsletter links, and every removed link can come back for 30 days."
tldr: "Every newsletter issue saves its links to All, and the unread ones outnumber the read. Readplace now clears them in one pass: the Newsletter Links Removal page behind the Inbox counts them first, removes only the links that were not read, opened, highlighted or changed, keeps every issue and every copy filed in another readlist, and holds each removed link for 30 days with a Restore that puts it back."
slug: "clear-out-the-newsletter-links-you-never-opened"
date: "2026-11-21"
author: "Fayner Brack"
keywords: "remove newsletter links, clean up reading list, read it later backlog, newsletter clutter, declutter saved articles, bulk remove saved links, restore removed links, newsletter links in reading list, read it later newsletter cleanup"
---

Counting the newsletter links in one account's All took 21.5 seconds in production. The slow part was the size of the pile.

The pile is a side effect of a promise. When a newsletter lands in Readplace, [every link in the issue is saved to All](/blog/save-newsletter-links-to-your-readlist?utm_source=blog-clear-out-the-newsletter-links-you-never-opened&utm_medium=internal&utm_content=post-save-newsletter-links-to-your-readlist), so the article behind any of them is already a clean page by the time it's wanted. The wanted ones get read. The rest stay, because All keeps every save.

A year of that and the list stops looking chosen. Scrolling All turns up row after row that arrived by email, saved on a publisher's linking habits rather than on anyone's intent. Removing them one at a time is the kind of chore that gets started once and abandoned around row 40.

> **A reading list where most rows arrived by email stops reading like a list of choices.**

## What the pass takes and what it leaves

The Inbox shows a line whenever All holds newsletter links. The button on it, Newsletter Links Removal, opens the page that runs the cleanup.

The pass takes only the untouched links. A link marked read stays in All. So does one that was opened, even if only its TL;DR was, one carrying a highlight, one saved again or changed by hand, and one the crawler could not read. The newsletter issues themselves stay, every one of them.

A link that was [filed into another readlist](/blog/newsletter-articles-land-in-the-readlist-they-belong-to?utm_source=blog-clear-out-the-newsletter-links-you-never-opened&utm_medium=internal&utm_content=post-newsletter-articles-land-in-the-readlist-they-belong-to) keeps that copy where it is. The removal reaches into All and nowhere else.

## The count runs before anything moves

Pressing the button removes nothing. The page counts first: how many unread newsletter links All holds, which newsletters sent the most of them, and how many links will be skipped, with the reason beside each number. That count is the same work that took 21.5 seconds on the largest account, so it runs in the background and the page fills in when the numbers land.

The decision then has a scope. The removal covers every newsletter, or only the senders ticked in the list the page draws, heaviest first. Remove newsletter links is the last button, and after it the Inbox line shows the job working, then the result: how many links went, how many were skipped.

TBH, the edge of the count is fuzzy for older saves: a link saved by hand before a newsletter ever linked to it can sit in the total, because nothing from back then recorded who saved it first. The confirm page says so beside the number, and the hold below exists for exactly that case.

## Held for 30 days, not deleted

A removed link moves into a hold, and for 30 days the Inbox line offers Restore removed links. Restore writes each held link back into All and leaves out any that already made it back, so running it twice can't double a row. A held link whose article is no longer stored can't be restored. The page lists it with its URL instead, ready to be saved again.

A removal that fails partway strands nothing either. The line says it couldn't finish, and whatever was already removed sits in the same hold, restorable like the rest.

Held links stay the account's data while they wait. A data export lists each one with its URL, its sender, when it was removed and when its hold ends. Once the 30 days pass, the hold ends on its own and the link is gone.

## Next week's issue still saves its links

The pass cleans up the past and changes nothing about what arrives next. Newsletters keep saving their links to All, because the next issue may carry the one article worth the whole subscription. Parting with a newsletter for good is a different act: stop forwarding it, disable the custom address it writes to, or change "What to save" on [a Gmail newsletter](/blog/introducing-gmail-integration?utm_source=blog-clear-out-the-newsletter-links-you-never-opened&utm_medium=internal&utm_content=post-introducing-gmail-integration). The removal page points the same way, right under the result.

## Behind the Inbox line

The line waits on [the Inbox](/inbox?utm_source=blog-clear-out-the-newsletter-links-you-never-opened&utm_medium=internal&utm_content=inbox) of any account whose All holds newsletter links, and the count is one click behind it. Nothing is removed until the numbers are on screen and the button under them gets pressed.

An All with nothing in it has nothing to clear. The saving starts at [readplace.com](/?utm_source=blog-clear-out-the-newsletter-links-you-never-opened&utm_medium=internal&utm_content=home).
