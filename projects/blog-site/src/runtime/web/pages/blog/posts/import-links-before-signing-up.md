---
title: "Import Your Reading List Before You Make an Account"
description: "Readplace's link importer is now reachable logged out. Upload a file or paste a link, review the URLs it finds, and pick what to keep before you sign up. The account waits until you commit, and your reviewed selections survive it."
slug: "import-links-before-signing-up"
date: "2026-06-23"
author: "Fayner Brack"
keywords: "import reading list, import Pocket links, import without signing up, Pocket alternative import, Omnivore import, migrate read it later, self serve import, try before signup, import bookmarks, read it later import"
tags: ["changelog"]
banner: "You can import your links before making an account"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Importing your saved links into Readplace used to need an account first. Now the importer is open logged out. You upload a file or paste a link, Readplace pulls every web address out of it, and you tick the ones you want to keep. The account waits for one button, Import selected, the step that actually saves the links. Sign up there and the review comes back as you left it, because an unfinished import is reached by its own unguessable link, not tied to an owner yet. The links save under your new account and fill in their titles and text on their own.

</div>
</details>

Bringing a saved reading list into a new app usually starts with making an account. The importer sits behind a signup form, so you hand over an email and a password before you have watched a single one of your own links arrive.

Readplace moved that form to the end. The upload, the review, and the picking now happen logged out. The account is asked for once, at the step that commits the links to your readlist.

## What you do before the account

Say your links live in a Pocket export, the file that service handed you on the way out. Or they sit on one page, a column of bookmarks you saved years ago. You open [readplace.com/import](/import) and give it the file, or paste the link.

Readplace reads what you give it as text. It finds every `http` and `https` address inside and lays them out as a list, each one checked by default. You page through and untick what you do not want. The list saves each choice on the server as you make it, so a long export does not lose your place.

None of that asked who you are. There is no account yet, and the review is yours to build before you decide Readplace is worth one.

> **The whole review gets built logged out, and the account comes after you have seen your list.**

## What carries the review across the signup

The account comes due at a single button, Import selected. Press it while logged out and Readplace sends you to sign up, then drops you back on the same review, every tick still in place.

That return is the part worth opening up. A half-built import has no owner. Readplace reaches it by capability instead: the review lives at a long, unguessable address, and holding that address is what grants access. A private share link works the same way. When you finish signing up, your new account adopts the review at that address, and the selections travel with it.

So there is no anonymous account left holding your links, and no migration step that moves them over later. The review was reachable by its link the whole time, and it stays ownerless to the end. Signing up does not change that. It only lets you commit, and the owner attaches to the links you save. The review itself is discarded once those links are under your account. The database keeps the same rule one layer down. An import with no owner is open to whoever holds the link. An import with an owner is closed to anyone but its owner.

On commit, the links you kept save under your account at once, showing just the site name at first. The reader text, the title, and the short summary fill in over the next moments. That is the same pipeline that runs when you save one link by hand, so the cards show up right away and finish on their own.

## Where the self-serve path stops

Two limits sit on the edge of this. A file over 4.5 MB, or an import past 2,000 links, hands off to a slower path: you email the export to readplace+migrate@readplace.com and I bring it in by hand. Under those bounds, the whole thing runs start to finish without anyone else touching it.

## Ask for trust too early and people leave

Readers who closed Pocket or Omnivore and went looking for a new home did not want a leap of faith. They wanted to see their own list, whole, in the new place, before trusting it with anything. A signup form in front of the importer asks for that trust up front, before the app has shown them one thing. Plenty turn around right there.

I put the list before the form for that reason. Your links come back ticked and ready, and the account is what you do once you have decided to keep them. The order matches how the choice gets made. If you came from a service that shut down, the [Pocket recovery guide](/blog/pocket-migration) and the [Omnivore writeup](/blog/omnivore-alternative) cover what moved those readers.

A signup wall in front of the importer keeps strangers out. A signup wall at the commit step lets a stranger turn into a reader.

If your old list is sitting in an export file, or spread across a page of links, open [the importer](/import) and watch it come back before you decide to keep it.
