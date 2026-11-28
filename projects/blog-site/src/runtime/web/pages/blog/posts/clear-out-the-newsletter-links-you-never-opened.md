---
title: "Clear out the newsletter links you never opened"
description: "All keeps every link a newsletter saves, and the unread ones pile up. The Newsletter Links Removal page counts them, shows which newsletters sent the most, and removes them and their issues from All and every readlist in one pass. Read and highlighted links and issues stay, and each removed one can be restored for 30 days."
excerpt: "On the paid plan, one pass clears the unread newsletter links, and each can come back for 30 days."
tldr: "Every newsletter issue saves its links to All, and the unread ones outnumber the read. Readplace now clears them in one pass: the Newsletter Links Removal page behind the Inbox counts them first, removes the links and issues that were not read, highlighted or changed from All and from every readlist they were filed in, and holds each removed one for 30 days with a Restore that puts it back."
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

The pass takes every newsletter link that was not marked read or highlighted. A link marked read stays in All. So does one carrying a highlight, one saved again or changed by hand, and one the crawler could not read. A link that was only opened goes with the rest, and so does one added to Hand Picked. The newsletter issues go by the same rule: an issue marked read or highlighted stays, and every other one leaves All, its readlists and the Inbox.

A link that was [filed into another readlist](/blog/newsletter-articles-land-in-the-readlist-they-belong-to?utm_source=blog-clear-out-the-newsletter-links-you-never-opened&utm_medium=internal&utm_content=post-newsletter-articles-land-in-the-readlist-they-belong-to) leaves that readlist too. A cleared newsletter leaves no copy behind in any readlist.

## The count runs before anything moves

Pressing the button removes nothing. The page counts first: how many unread newsletter links All holds, which newsletters sent the most of them, and how many links will stay, with the reason beside each number. That count is the same work that took 21.5 seconds on the largest account, so it runs in the background and the page fills in when the numbers land.

The decision then has a scope. The removal covers every newsletter, or only the senders ticked in the list the page draws, heaviest first. Remove newsletter links is the last button, and it opens a popup that says once more what goes and what stays. Removing and restoring are part of the paid plan, so on the free plan that button leads to the plans page instead. After it the Inbox line shows the job working, then the result: how many links went, how many were skipped.

TBH, a link saved by hand counts too when a newsletter also saved it. Nothing tells the two saves apart well enough to keep one and take the other, so the hold below exists for exactly that case.

## Held for 30 days, not deleted

A removed link moves into a hold, and for 30 days the Inbox line offers Restore removed links. A plan that ends inside those 30 days has to be upgraded again before Restore works, or the held links expire. Restore writes each held link and issue back into All and into every readlist it was in that still exists, puts each issue's email back in the Inbox, and leaves out any that already made it back, so running it twice can't double a row. A held link whose article is no longer stored can't be restored. The page lists it with its URL instead, ready to be saved again.

A removal that fails partway strands nothing either. The line says it couldn't finish, and whatever was already removed sits in the same hold, restorable like the rest.

Held links stay the account's data while they wait. A data export lists each one with its URL, its sender, when it was removed and when its hold ends. Once the 30 days pass, the hold ends on its own and the link is gone. A removed issue goes further: its email and everything stored for it are deleted.

## Next week's issue still saves its links

The pass cleans up the past and changes nothing about what arrives next. Newsletters keep saving their links to All, because the next issue may carry the one article worth the whole subscription. Parting with a newsletter for good is a different act: stop forwarding it, disable the custom address it writes to, or change "What to save" on [a Gmail newsletter](/blog/introducing-gmail-integration?utm_source=blog-clear-out-the-newsletter-links-you-never-opened&utm_medium=internal&utm_content=post-introducing-gmail-integration). The removal page points the same way, right under the result.

## Behind the Inbox line

The line waits on [the Inbox](/inbox?utm_source=blog-clear-out-the-newsletter-links-you-never-opened&utm_medium=internal&utm_content=inbox) of any account whose All holds newsletter links, and the count is one click behind it. The removal itself runs on [the paid plan](/?utm_source=blog-clear-out-the-newsletter-links-you-never-opened&utm_medium=internal&utm_content=pricing#pricing). Nothing is removed until the numbers are on screen and the button under them gets pressed.

An All with nothing in it has nothing to clear. The saving starts at [readplace.com](/?utm_source=blog-clear-out-the-newsletter-links-you-never-opened&utm_medium=internal&utm_content=home).
