---
title: "Saved the Instant You Click, Even If You Close the Tab"
description: "The Readplace browser extension used to make you wait for the whole page to upload before it said Saved. Now it saves your link the instant you click, so you can close the tab a second later and still keep it. The page finishes uploading on its own, in both Chrome and Firefox."
slug: "save-a-link-and-close-the-tab"
date: "2026-08-01"
author: "Fayner Brack"
keywords: "save articles fast browser extension, read it later extension instant save, chrome extension read it later, firefox extension read it later, save a link before the page uploads, background upload queue browser extension, extension save without signing you out, pocket alternative browser extension, save an article without waiting, read it later save button fast"
tags: ["changelog"]
banner: "I made the extension save your link the instant you click"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Clicking save in the browser extension used to read the whole rendered page, upload it, and only then say Saved. That wait had nothing to do with whether the link was in your queue. Readplace now posts a save with the URL alone and paints Saved the instant the server records it. Capturing the page and uploading it move to a persisted background queue, woken on a timer, so they finish after the popup closes and pick themselves back up if the browser reclaims the worker mid-upload. The job is keyed to the exact address you saved from, not the page's canonical URL, so the bytes land on the article you watched appear rather than a near neighbour. One change had to land first. A background upload that runs an hour later meets an expired access token, and a 401 used to sign you out on the spot. The fetch layer now refreshes the token and replays the request, and only tears the session down if the refresh itself fails. Chrome and Firefox both save this way now. What you give up is the wait. What you keep is the link, even if you close the tab a second after the button turns green.

</div>
</details>

Saving a link and uploading its page are two different jobs. The browser extension used to run them as one. A click on save, and the button sat on "Saving" while it read the whole rendered page, uploaded the bytes, and waited for the server to answer. Only then did it say Saved.

None of that work decides whether the link is in your queue. The save is finished the instant the server writes the row and answers [201](/view/developer.mozilla.org/en-US/docs/Web/HTTP/Status/201). Capturing the page and uploading it are a separate errand, and the old popup made you stand in line for it before it would admit the first job was done.

> **A save should tell you the link is in your queue, not make you wait for the page to arrive.**

## The save answers first

The popup now posts a save that carries the URL and nothing else, and it repaints the button the moment the server records it. No page read. No upload. No pre-flight round trip to ask whether the link was already there. The button turns on the one request that puts the link in your queue.

That pre-flight check is worth a word, because dropping it changed a behaviour. The extension used to ask the server whether you had this link already, then decide what to do. It doesn't ask now. A second save of the same link is an upsert, the same thing the website's save bar has always done: save it again and the article moves back to the top of your queue, unread.

## The upload that outlives the popup

Capture and upload didn't vanish. They moved to a queue that keeps running after the popup is gone. A background wake nudges it, it walks the pending jobs oldest first, and it writes down each job before the capture starts.

That last part is the one that matters when things go wrong. A background page in an extension is disposable. The browser can decide the worker is idle and reclaim it, and if that lands in the middle of a capture, the job is already recorded, so the next wake finds it and starts over. The captured bytes wait their turn in the browser's own on-disk store, [IndexedDB](/view/developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), so a page you saved before you shut the laptop is still there to upload when it opens.

> **The link is saved in one round trip. The page catches up on its own time.**

## The URL the bytes belong to

There's a detail here that had to be exact, or the whole thing saves the wrong article without telling you. The upload is keyed to the byte-identical address the save used, character for character. The old pre-capture path substituted the page's canonical URL instead. On a page that declares a canonical different from the one in your address bar, that substitution would land the captured bytes on a neighbouring article, the one the page claims to be rather than the one you were reading. This is the same reason Readplace [saves the article, not the redirect it arrived through](/blog/save-the-article-not-the-redirect). The save you watched turn green and the page that uploads behind it now name the same URL.

## The token that used to sign you out

Deferring the upload broke an assumption the old code rested on. Every request used to leave while the popup was open, a second or two after you clicked, so an expired token was rare. An upload that runs an hour later makes it the normal case.

The access token expires long before the refresh token does. A reader who left the popup closed for an hour was signed out by the next tab activation, with a good refresh token sitting unused in storage, because a 401 logged them out outright. The fetch layer holds the request it was making, gets a fresh token, and replays the same request. It only tears the session down if the refresh fails, or the replay comes back 401 again.

The refresh step is a required dependency now, not an optional one, so a build of the extension that falls back to the old sign-out won't compile. That was the piece that had to ship before either extension could defer an upload at all.

## Green before the page loads

Chrome shipped this first. Firefox followed the same week on the same shared code, so both extensions save the link before they touch the page, and everything that only existed to bridge the two behaviours went with it.

Save the next thing you meant to get to later with [the browser extension](https://readplace.com/install) and watch the button turn green before the page it's sitting on has finished loading. What you saved is waiting at [readplace.com](/) when the evening is quieter than the afternoon.

Waiting for the upload told you the page had arrived. Turning green at the save tells you the one thing you clicked to find out: the link is yours to read later.
