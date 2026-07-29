---
title: "An Off Switch Should Turn Back On"
description: "Disabling a Readplace newsletter address used to be a one-way door. It never deleted the address, but you couldn't get it back either, and recreating the name minted a different one that broke every subscription. Every disabled address now carries an Enable button that brings the same address back to life."
slug: "re-enable-a-disabled-newsletter-address"
date: "2026-07-29"
author: "Fayner Brack"
keywords: "re-enable disabled email address, reactivate newsletter forwarding address, turn a newsletter email back on, disposable email you can re-enable, per-newsletter email alias read it later, undo disabling an inbox email, recover a disabled forwarding address, forward newsletters to read later, newsletter inbox reader, read it later newsletter address"
tags: ["changelog"]
banner: "I let you switch a disabled newsletter address back on"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Switch off a newsletter address in Readplace and, until this week, there was no switching it back on. The address was never deleted, because a forwarding address that got re-minted for another reader could leak the first reader's mail into a stranger's queue. Disabling stamped a marker on the row and left it in place. Getting the address back meant creating it again, but re-typing the name minted a fresh random tail, so you ended up with a different address and every subscription pointing at the old one went quiet with nothing to tell you. Every disabled address now sits in a collapsed list with an Enable button that clears the marker and returns the exact address you had, and the receive path delivers to it again the moment it flips. Enabling counts against the cap of 25 live addresses, so at the cap the address stays disabled until you free a slot. An address that belongs to a closed account, or to another reader, fails the ownership check and can't be revived.

</div>
</details>

Every Readplace forwarding address ends in six random characters. That tail is the reason a disabled one used to be gone for good.

A forwarding address is how a newsletter reaches your reading queue. You name it after the source, so a subscription to TLDR becomes something like tldr-a7b2c9@read.place, and the issues sent there [turn into saved articles instead of inbox clutter](/blog/save-newsletter-links-to-your-queue). The six characters on the end are what keep the address yours. Two readers can both name one netflix, and the random tail is the only thing telling their addresses apart.

Disabling one is a single click. A list you stopped reading, or a source that got sold and started arriving twice a week. You switch it off and the mail stops.

## The door that opened one way

Switching it off was where the trouble sat. Disable opened one way and had no handle on the other side.

Say you disabled netflix-a7b2c9@read.place and a month later wanted it back. The obvious move is to make it again. You type netflix, and Readplace hands you netflix-9f3k2p@read.place. A different address. The tail is random by construction, so re-typing the name cannot reproduce the one you had. Every subscription still aimed at the old address keeps sending mail there, and none of it lands. Nothing warns you. The newsletters just go quiet.

> **Recreating the name gave you a new address, and the old one's mail fell on the floor.**

## A name that can't be re-minted

So why not delete a disabled address and free the name outright? Because a forwarding address can never be safely handed out twice.

The address is a private handle onto one person's mail. Delete it, mint the same string later for someone else, and a newsletter that never heard about the change forwards the first reader's issues into a stranger's queue. So an address is never deleted. Disabling stamps the row with a marker and leaves it exactly where it is. Off, but still yours, still pointing at you and nobody else.

A per-newsletter address is [disposable](/view/en.wikipedia.org/wiki/Disposable_email_address) on purpose, so you can cut a noisy source without touching your real inbox. What was missing is that disposing of one read as final. The row survived, and that survival is the whole reason bringing an address back is possible at all.

## The button in the collapsed list

Disabled addresses now gather in a collapsed group under the active ones, each with an Enable button beside it. Press it and the marker clears. The address is live again, the same string down to the last character, and the receive path starts delivering to it the instant it flips. The subscriptions that were quietly failing land in your queue again, and you never opened the newsletter's settings.

> **The address that comes back is the one you lost, not a fresh one wearing its name.**

Two limits sit behind the button, and both are worth saying plainly. Readplace caps you at 25 live addresses, one per newsletter, so the active set stays small enough to read. Enabling counts against that 25. If you're already at the cap, Enable won't go through and the address stays disabled until you switch another off to make room. The at-cap message reads accordingly now: disable what you don't need before enabling or creating more.

The second limit is ownership. Enabling confirms the address is yours before it clears anything, so an address left behind by a closed account, or one that belongs to another reader, fails the check and can't be revived. TBH that guard is the same one disabling has always run. Bringing an address back reaches no row that switching it off couldn't already reach.

## Switch a cut address back on

Disabling a forwarding address and deleting it look the same from where you stand. The mail stops either way. The difference is whether the switch keeps a way back, and now it does.

If a newsletter you cut still has a disabled address waiting in that collapsed list, open [your inbox addresses](/inbox/addresses) and turn it on. If you've never handed a newsletter an address of its own, [readplace.com](/) is where the first one gets made.
