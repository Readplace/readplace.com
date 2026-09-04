---
title: "Dark Mode That Travels With Your Account"
description: "Dark mode in a reading app usually obeys the operating system, or a toggle buried in one browser's storage. Readplace now takes the reader's own answer: System, Light, or Dark, picked once on the account, rendered into the page before it leaves the server, and read by the iPhone and Android apps from the same setting. There is no flash of the wrong theme on the way in."
slug: "dark-mode-that-travels-with-your-account"
date: "2026-09-04"
author: "Fayner Brack"
keywords: "dark mode reading app, read it later dark mode, dark theme article reader, override system dark mode, dark mode without the flash, theme flash on page load, account dark mode setting, pocket alternative dark mode, readplace"
tags: ["changelog"]
banner: "I taught dark mode to follow your account"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Dark, Light, or System is now a choice on the account instead of a property of each screen. Picked once under Account, it reaches the web pages, the reader inside the apps, and the native chrome of the iPhone and Android apps, because Readplace resolves it on the server while the page renders. A dark page doesn't open light first. System stays the default and follows the OS exactly as before.

</div>
</details>

Every screen has its own opinion about when dark mode starts. The phone flips at sunset. The laptop has been dark since the day it was unboxed. Until this week, a Readplace page sided with whichever device happened to be rendering it.

For a reading app that is the wrong authority. Reading runs in long sessions at odd hours, and the hour before sleep is where a readlist earns its keep. An OS schedule knows where the sun is. It doesn't know about the reader who wants dark at noon in a bright office, or the one who wants a lit page in a dark room because that is what reading in bed looked like for the whole life of the paperback.

So the choice moved onto the account.

Under [Account](/account) there is now a section called Appearance with 3 buttons: System, Light, and Dark. Press one and the answer is stored with the account itself, not with the screen it was pressed on.

## The phone follows the laptop

A read-it-later app is split across devices by design. The save happens at a desk, and the reading happens wherever the evening does. A theme preference split the same way falls out of sync within a week.

Stored on the account, it can't. Pick Dark on the laptop and the phone has no say left: the iPhone app reads the setting from the account and themes its native chrome to match, and the Android app does the same. The reader view both apps open inside themselves renders on the same answer, so there is no light page framed by a dark app.

## Dark from the first byte

The common way a site remembers a theme is in the browser. The choice sits in local storage, a script reads it after the HTML arrives, and a class gets swapped in. Between arrival and swap the page wears the wrong theme, which is why a dark-mode toggle so often comes with a white blink on every load. A choice kept that way also stays in one browser: the laptop knows, and the work machine doesn't.

Readplace skips both problems because the server already knows whose page it is building. The theme is resolved while the HTML renders, so the page leaves the server already wearing the right one. Even the colour a phone browser paints its own toolbar with is sent as the single correct value rather than a guess to fix later. Nothing repaints after arrival, and because the 3 buttons are a plain form, the whole thing works with JavaScript turned off.

> **A page that already knows its reader has nothing to correct in front of them.**

## System keeps its job

System is the default, and it behaves exactly as the product did last month: the page ships both theme colours behind [`prefers-color-scheme`](/view/developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme) media queries and the OS keeps deciding. I left it that way on purpose. An account that skips the new section notices nothing.

The choice also stops at the sign-in line. A signed-out page has no account to ask, so it stays pinned to the light palette. And the dark palette didn't change a pixel this week. Its body text already reads at 14.73:1, well past the floors [the e-ink audit](/blog/saved-articles-hold-up-on-e-ink) held the rest of the product to, so this change decides when that palette shows rather than what it looks like.

## 3 buttons under Account

The switch sits in [Account](/account), under Appearance. Press Dark once, and [your readlist](/) opens dark on every screen you sign into, at noon and at midnight alike.
