---
title: "Why Readplace Blocks Disposable Email at Signup"
description: "Readplace turns away disposable inboxes at signup. A read-it-later list only pays off in the gap between saving and reading, and a throwaway address is gone before the gap opens, so the form asks for an inbox you keep."
slug: "disposable-email-blocked-at-signup"
date: "2026-06-20"
author: "Fayner Brack"
keywords: "disposable email signup, temporary email read it later, throwaway email blocked, read it later sign up, real email required, Readplace signup, disposable email blocklist, 10 minute mail, read later account, no fake email"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

A throwaway inbox works for 10 minutes and then forgets you, which is the opposite of a reading list you mean to come back to. So Readplace turns those addresses away at signup. The form reads the domain after the @, checks it against a list of more than 7,000 disposable services, and walks up the name so a fresh subdomain does not slip past. The list comes from an open, community-maintained project, synced by a script and topped up by hand. Sign up with the inbox you actually open, and the account is one that can still reach you next month.

</div>
</details>

More than 7,000 email domains can't be used to sign up for Readplace. Every one of them belongs to a disposable inbox service, the kind that hands you an address that works for 10 minutes and then forgets it existed. The signup form checks each new email against that list and turns those addresses away.

Blocking signups is a strange move for a young product. Most of the advice runs the other way: lower the bar, ask for less, let anyone through. I went the other direction on this one kind of address, and the reason is what the address is for.

## What the signup form turns away

When you register, Readplace reads the domain after the @ in your email. It compares that domain against a blocklist of disposable services. A match stops the form and shows a message instead of creating the account.

The check does not stop at the exact domain. It walks up the name. An address at `mail.10minutemail.com` gets caught even when only `10minutemail.com` sits on the list, because the check tests the full host first, then each parent domain above it. A throwaway service can spin up a new subdomain in seconds. Walking up the name means a fresh subdomain buys it no way past the gate.

The message says what the rule is for, in plain words: "This is a disposable email address. I value your privacy but to avoid abuse I need a real person to register." The aim is not to collect more of your data. It is to know a person sits on the other side who can come back.

## Where the blocklist comes from

The list is not one I type out by hand. Readplace syncs it from [disposable-email-domains](https://readplace.com/view/github.com/disposable-email-domains/disposable-email-domains), a community-maintained blocklist released under CC0, which puts it in the public domain for anyone to use. A script fetches the upstream file, drops duplicates, sorts the result, and writes the canonical list. Re-running that script is the whole update. The list refreshes from the source and nothing else moves.

A second, shorter file sits next to it for additions I make by hand. A re-sync rewrites the canonical list and never touches the custom one, so a domain I add to catch a service the upstream missed survives the next refresh. The signup check reads both files and merges them when the server starts.

> One generated list I never edit, one hand-kept list the sync never clobbers.

That split is the part I would have got wrong a year ago. Mix hand edits into a generated file and the next sync wipes them, so you stop syncing, and the list goes stale. Keeping the two apart means I can pull the latest upstream blocklist any day without losing the few domains I added myself.

## A reading list only works if you come back

Readplace saves things for later. The worth of a saved article sits in the gap between the day you save it and the day you read it. That gap is the product. Close it and there is nothing left to keep.

A disposable inbox is built to close that exact gap. You take an address, you use it once, and by the time anything wants to reach you, the inbox is gone and the account behind it is a dead end. A login tied to an address like that was never going to open the reading list again.

So the one signup I refuse is the one that argues against the thing the product is.

There is an abuse side too. Throwaway addresses are how one person registers a hundred accounts, hammers a crawler, or farms a free tier. Asking for a real inbox raises that cost and asks nothing of the people who came to read. If you came over from a service that shut down, the reasons those readers moved are in [the Pocket recovery guide](/blog/pocket-migration) and [the Omnivore writeup](/blog/omnivore-alternative).

## Sign up with an inbox you keep

Use the email you actually open, the one your other accounts already reach you at. The signup wants a real address and a password, and that is the whole gate.

Make the account with the inbox you keep, and start a reading list built to outlast the day you opened it. [Install the browser extension](https://readplace.com/install) or start at [readplace.com](/).
