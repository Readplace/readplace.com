---
title: "The Faint Ink Is Gone From Every Screen"
description: "The wordmark's amber tail read at 3.62:1 on white, Android's error words at 3.86:1, and an empty field's edge at 1.17:1. A contrast pass across the web app, the iPhone app and the Android app moved each pair of ink and background over its WCAG floor, in colour and in greyscale, and 302 re-recorded screenshots hold the new values in place."
excerpt: "The logo's own amber tail measured 3.62:1 on white, under the floor article text is held to."
tldr: "Words and marks across the web app, the iPhone app and the Android app sat under their contrast floors: a login error at 4.17:1, menu words at 3.86:1, an empty field's only edge at 1.17:1, and the amber tail of the logo itself at 3.62:1. Readplace moved each one onto darker ink, measured in colour and again in greyscale for e-ink panels, in light and dark themes, and each platform's test suite now re-checks the numbers so a later change can't walk them back."
slug: "the-faint-ink-is-gone-from-every-screen"
date: "2026-11-24"
author: "Fayner Brack"
keywords: "high contrast reading app, readable in sunlight, wcag aa reading app, dark mode contrast, e-ink contrast, accessible read it later app, faint text fix, contrast ratio 4.5:1, low vision reading app"
---

On white, the amber tail at the end of the Readplace wordmark measured 3.62:1.

Article text in the reader has been held to a 4.5:1 floor since [an August pass over the reading pages](/blog/saved-articles-hold-up-on-e-ink?utm_source=blog-the-faint-ink-is-gone-from-every-screen&utm_medium=internal&utm_content=post-saved-articles-hold-up-on-e-ink). The logo was not.

It carried a claim instead: that 16px at bold weight counts as large text, where [the WCAG rule](/view/www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html?utm_source=blog-the-faint-ink-is-gone-from-every-screen&utm_medium=internal&utm_content=read-www-w3-org) lowers the floor to 3:1. Large text at that weight starts at 18.66px. The claim fell 2.66 pixels short, and it was written into the brand guidelines.

> **The logo is words, and words have a floor.**

The tail now takes the darker amber the links already use, 5.06:1 on white and 5.72:1 with the colour stripped out. On the navy band of the home page it takes a deeper gold pinned for that surface alone.

The "large text" line is out of the brand guidelines, and the pass that caught the logo went over the chrome around the reading: banners, badges, menus and the fills behind them.

## Measured twice, the second time in grey

Each pair of ink and background on the web and on Android was read 4 ways: light theme, dark theme, and each of those again with the hue removed.

The grey reading exists for screens that drop colour.

An e-ink panel shows 16 greys and nothing else, and a pair that keeps its contrast without hue doesn't depend on telling red from green either. Plain sRGB greyscale also disagrees with WCAG's luminance maths by up to 0.7:1, so a pair that scrapes past on a laptop can sink on a Kobo.

## The phones held the faintest words

Android kept its error words in a red that read between 3.86:1 and 3.93:1 on a light menu. Those words turn up at the worst moments: a failed login, the Delete entry in a row's menu, the destructive button under a dialog.

They moved to a dedicated error ink. The same menu words now measure 4.68:1 to 5.22:1, the login error went from 4.17:1 to 5.54:1 on white, and dark-theme error words climbed from 4.49:1 to 6.10:1 in grey.

The fills moved with the words.

Android's error banner and the delete side of its swipe tray now share the pinned red a destructive web button fills with on hover and press, white on #B95050 at 4.85:1. The iPhone app's error banner copies it, so all 3 platforms now use the same red.

The tray's mark-as-read side holds its white at 4.98:1. The share sheet's warning glyph and the offline badge took pinned inks of their own, each over its floor in both themes and both readings.

## An edge at 1.17:1

The worst number of the pass wasn't text.

An empty form field on the web drew its one boundary, a 1px edge, at as little as 1.17:1 against the page behind it. A box meant to be typed into arrived close to invisible.

The edge took a token of its own and now reads 3.55:1 on white, over the 3:1 floor for marks that aren't words. 2 more web stragglers went with it: the "Saved offline" badge's green, which sat at 4.35:1 in light, and one amber price tag in the home page's plan table, which moved onto the darker amber ink.

## 302 screenshots were re-recorded

None of it stays put on good intentions.

The web's contrast sweep measures each listed pair in both themes and in greyscale, and the home page's bands joined it. On Android, banner fill and ink go through a named greyscale check in both themes. The iPhone app re-recorded the 5 snapshot baselines the darker values moved.

The web change alone re-recorded 297 screenshots: 279 in the web app, 8 in each of the Chrome and Firefox extensions, and 2 in the inbox. A listed pair that falls under its floor now fails the build instead of waiting for the next audit.

## Daylight is the test

A contrast ratio shows up nowhere in the product. What shows up is a phone at full brightness on a footpath at noon, or a dark room at the other end of the day. An e-ink reader has no colour to drop, and the grey reading was measured for it.

The warnings, the badges and the logo itself hold their ink through each of those, in [either theme](/blog/dark-mode-that-travels-with-your-account?utm_source=blog-the-faint-ink-is-gone-from-every-screen&utm_medium=internal&utm_content=post-dark-mode-that-travels-with-your-account), with no setting behind it.

The darker ink is live now at [readplace.com](/?utm_source=blog-the-faint-ink-is-gone-from-every-screen&utm_medium=internal&utm_content=home), and the [iPhone](/blog/readplace-iphone-app-on-the-app-store?utm_source=blog-the-faint-ink-is-gone-from-every-screen&utm_medium=internal&utm_content=post-readplace-iphone-app-on-the-app-store) and [Android](/blog/readplace-android-app-on-google-play?utm_source=blog-the-faint-ink-is-gone-from-every-screen&utm_medium=internal&utm_content=post-readplace-android-app-on-google-play) apps get it in their next release.
