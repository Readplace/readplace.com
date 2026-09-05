---
title: "Dark Mode That Follows Your Account, Not Your Device"
description: "The light-or-dark decision used to sit with each device's operating system, set for reasons that have nothing to do with reading. A new Appearance setting picks System, Light or Dark once per account, the server renders the page already in that theme, and the iPhone and Android apps follow the same pick."
slug: "dark-mode-that-follows-your-account"
date: "2026-09-05"
author: "Fayner Brack"
keywords: "dark mode, light mode, reading theme, read it later dark mode, theme flash, flash of wrong theme, account preference, readplace"
tags: ["changelog"]
banner: "I made your reading theme follow your account, not your device"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Dark mode used to be whatever each device's operating system said, on each machine separately. A new Appearance setting on the Readplace account page picks System, Light or Dark once, and the pick reaches the web readlist, the article reader, and the iPhone and Android apps on any device signed into the same account. The server resolves the choice before the page leaves it, so a dark reader arrives dark instead of flashing white first.

</div>
</details>

Until this week, whichever device opened Readplace decided the theme it rendered in. The reader followed the operating system's light-or-dark setting. That setting lives per machine, and it gets chosen for reasons that have nothing to do with reading.

A work laptop stays light because spreadsheets and video calls look better that way. A phone goes dark for its battery. Neither setting was ever about how an article should look at 11pm.

A reading theme is a preference about reading, so it now lives where the reading does: on the account.

## System, Light, Dark

The account page grew an Appearance section with 3 buttons. System is the default, and it does what the site did before, following whatever the device says. Nothing moves for a reader who leaves it alone.

Pick Light or Dark and the device's opinion stops mattering. An article opens dark at noon on the lightest laptop in the office, if dark is the pick on the account.

What about wanting dark on the phone but light on the laptop? That split is what System is for, and why it stays the default: it hands the decision back to each device instead of overruling them.

## The page arrives already dressed

The choice is applied on the server, while the HTML is still being written. The body class carries the theme, and so does the colour a phone browser paints its own bars with, before the first byte leaves Sydney.

That ordering is the part I cared about. A site that keeps its theme toggle in browser storage sends a default-coloured page and corrects it once its script runs, and on a slow connection the correction is visible: a white flash ahead of a dark read.

> **A theme the server already knows needs no script to repaint the page it just sent.**

## Where the pick travels

The preference sits on the account itself, so it reaches whatever signs in. The web readlist and the article reader stamp it into the page. The iPhone and Android apps read it from the same response they already fetch the readlist through, and they theme their own native bars and sheets to match, so the chrome around an article goes dark with the article.

Sign into a new browser and the theme is there before any settings page is opened. The pick travels with the account rather than being rebuilt, device by device, from memory.

## The pages that stay light

Not every page follows the pick. Logged-out pages hold their light pin, because a preference stored on an account can't apply before anyone signs in.

The dark palette itself didn't move either. Its body text already measures 14.73:1 against its background, well past the contrast gates [the e-ink audit](/blog/saved-articles-hold-up-on-e-ink) left running on each build, so this week changed who decides when that palette is used, not what it looks like.

A theme that follows the device is a fact about the machine. A theme that follows the account is a fact about the reader.

The 3 buttons sit under Appearance on [your account page](/account), and a pick made on a laptop tonight is on the phone by morning. An account to hang a theme on comes with the first save at [readplace.com](/).
