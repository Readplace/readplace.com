---
title: "Dark Mode Moved From Your Phone to Your Account"
description: "A phone set to dark and a laptop left light opened the same saved article in 2 different themes, and the only lever was the operating system's global switch. One Appearance setting on the account now answers for every signed-in page and both native apps, resolved on the server so nothing flashes on the way."
slug: "dark-mode-moved-to-your-account"
date: "2026-09-06"
author: "Fayner Brack"
keywords: "dark mode read it later app, dark theme reading app, dark mode sync across devices, night reading dark mode, no flash dark mode, server rendered dark theme, reading app appearance setting, pocket alternative dark mode, read it later dark theme, dark mode without javascript"
tags: ["changelog"]
banner: "I moved dark mode from the device to your account"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Signed-in pages used to take their theme from whichever device opened them, so a phone in dark and a laptop in light read the same article 2 different ways. Readplace now keeps one Appearance preference on the account: System, Light, or Dark. The server resolves it while rendering, so pages arrive already in the right theme with no flash, and the iPhone and Android apps theme their native chrome from the same answer.

</div>
</details>

System, Light, Dark. The 3 buttons landed on [the account page](/account?utm_source=blog-dark-mode-moved-to-your-account&utm_medium=internal&utm_content=account) this week under a heading called Appearance, and what they decide is where dark mode lives: on the account now, rather than on the device.

Until now a signed-in page took its theme from [`prefers-color-scheme`](/view/developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme?utm_source=blog-dark-mode-moved-to-your-account&utm_medium=internal&utm_content=read-developer-mozilla-org), the flag a device raises when its whole operating system turns dark. The flag speaks for the machine. It can't tell an article at midnight from a spreadsheet at noon.

That put the choice in the wrong place twice over. Going dark meant flipping the entire device dark, and keeping the device light meant reading a white page in a dark room. Across hardware it split again: a phone set to dark and a laptop left light opened the same saved article in 2 different themes, decided by nothing more than which machine was closer to hand.

Mine stays light, because daytime work looks better that way, and most of my reading happens after the OS's opinion has stopped being right.

## Dark that arrives already dark

The preference lives on the account's row in the database, which is a dull sentence with a visible consequence. A theme toggle stored in the browser gets read by a script after the page arrives, so the page paints in its default first and corrects itself a beat later. That correction is the white blink dark-mode readers know by heart.

Readplace resolves the theme on the server instead, while the page is still being rendered. The HTML shows up already wearing the right class, the browser's own chrome takes a matching `theme-color`, and no script runs to make any of it true, so a reader with scripting turned off keeps their theme too.

> **A page that arrives already themed has no moment of being the wrong colour.**

## Both apps take the same answer

The preference also travels out through the API. The iPhone and Android apps read it from the account and theme their native chrome with it, not just the article in the middle: on iOS it drives the app's colour scheme, on Android the app-wide theme, and the in-app reader follows along.

So the setting behaves the way the readlist does. Pick Dark on the laptop and the phone app opens dark next time, with nothing to repeat on the second device or the third.

## The button that does nothing

System is the default, and System does nothing on purpose. It stamps no theme, so the page keeps following the device exactly as it did before this shipped, and an account that never visits the setting notices no change at all.

What does pressing it buy, then? A way back. Light and Dark are each a standing answer, and System is the button that hands the question to the OS again.

2 boundaries are worth naming. Most logged-out pages stay pinned to the light palette, the one [the contrast audit](/blog/saved-articles-hold-up-on-e-ink?utm_source=blog-dark-mode-moved-to-your-account&utm_medium=internal&utm_content=post-saved-articles-hold-up-on-e-ink) measured, and the reader is the deliberate exception: a guest opening a shared article has no account preference to read, so that one page follows the device's own light-or-dark setting. And no new dark palette ships here: the dark theme is the same one as last month, its body ink already at 14.73:1.

Dark is one press under Appearance on [the account page](/account?utm_source=blog-dark-mode-moved-to-your-account&utm_medium=internal&utm_content=account), and the press holds on every screen the account signs into, including the one in bed. A readlist to try it on takes a minute to open at [readplace.com](/?utm_source=blog-dark-mode-moved-to-your-account&utm_medium=internal&utm_content=home).
