---
title: "Save All Your Tabs and Walk Away"
description: "A 29-tab window took 13 seconds to save, and the extension popup spent all of them on a bare \"Saving tabs…\" that repainted once, at the end. Save all tabs now counts every captured page and every send as it happens, keeps running after the popup closes, and reports the final tally in 1 notification."
excerpt: "Saving 29 tabs took 13 seconds, and the popup spent all of them on 2 frozen words."
tldr: "The Save all tabs button in the Chrome and Firefox extensions now shows its work: \"Captured 12 of 29\" while pages are copied from their tabs, then \"Sent 24 of 29 · Sending 5\" as they reach Readplace, then a tally naming what saved and what was skipped. Closing the popup mid-run keeps the run going, and 1 notification brings the final count. Reopening the popup on a tab the run covers shows it live, and a reply that goes missing gets 1 follow-up, then a \"Couldn't save tabs\" alert instead of \"Saving tabs…\" left up for good."
slug: "save-all-your-tabs-and-walk-away"
date: "2026-10-25"
author: "Fayner Brack"
keywords: "save all tabs, save all open tabs, too many tabs open, close tabs without losing them, save tabs for later, bulk save tabs, browser extension save tabs, tab hoarding, read it later browser extension, readplace"
tags: ["changelog"]
banner: "Saving every tab no longer means watching a frozen popup"
---

13 seconds is how long a 29-tab window took to save. For all 13 of those seconds, the toolbar popup showed the same 2 words, "Saving tabs…", and repainted once, at the end.

That was the good case, measured against production. A reply lost between the popup and the extension's background worker left the 2 words up with nothing behind them, and one reader reported exactly that: a save that "stayed pending". The tabs were saving. The popup had no way to say so.

Both ends are fixed in the latest Chrome and Firefox extensions. The save takes the time it takes. What changed is what the popup shows during it, and whether it has to stay open at all.

## The count moves with the work

Press "Save 29 tabs" and the first paint reads "Saving 29 tabs…", with a count under it that follows the 2 stages each tab goes through.

The first stage copies each page out of its open tab, so the saved copy is the page as the tab shows it. "Captured 12 of 29" climbs as those copies land. Then the copies go to Readplace in batches, and the line switches to the sending side: "Sent 24 of 29 · Sending 5".

The run ends on a tally instead of a blank. "Saved 26 · Skipped 3", with Failed and Retrying segments only when there is something to put in them. Under the tally sit the reasons, in the popup's own words: "Only http and https URLs can be saved" for the settings tab that rode along, "Readplace's own pages aren't saved", and "Already open in another tab" for the second copy of one address, which saves once. A page too large to capture in full is saved as a link rather than dropped, and the tally names it.

## Closing the popup is now allowed

A toolbar popup closes on the first click outside it. That is how browsers work, and it made 13 seconds of saving a strange thing to put behind one: switch tabs to keep working and the only view of the save was gone.

The run doesn't live in the popup anymore. It lives with the extension's background worker, 1 run per window, written to session storage step by step, so a worker the browser stops mid-save picks the run back up on return. The popup is a window onto it. "Continue in background" makes leaving official, and plain closing does the same thing. Either way, 1 notification arrives when the run ends, carrying the tally the popup would have shown.

> **A save worth 13 seconds of work is not worth 13 seconds of watching.**

Reopening the popup on a tab the run covers picks the live count back up. On any other tab, the popup saves that one tab, the way a single save already works.

## A reply that goes missing gets 1 follow-up

The old screen couldn't tell slow from lost. A reply that goes missing, or arrives malformed, now gets 1 follow-up request, and if that one is lost too, the view ends on the "Couldn't save tabs" alert. A run ends on an answer.

The other dead end was counting. Saving a link on its own, while a bulk run still held a pending retry for it, used to re-send the link, bump it back to the top of the list and count it twice. The individual save now marks the link saved inside every run that holds it and withdraws the retry, so it ends up as 1 row, counted once.

## 29 tabs, 1 notification

Tab pileups have [their own entry on this blog](/blog/save-hacker-news-articles-for-later?utm_source=blog-save-all-your-tabs-and-walk-away&utm_medium=internal&utm_content=post-save-hacker-news-articles-for-later), and the advice there starts with moving the pile out of the tab bar. That move now costs 1 press. Save the window, close the popup, and read the tally when it arrives.

The button ships in [the browser extension](https://readplace.com/install), and the tabs land as cards in [your readlist](/queue?utm_source=blog-save-all-your-tabs-and-walk-away&utm_medium=internal&utm_content=readlist).
