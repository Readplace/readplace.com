---
title: "Highlighting no longer dims the article"
description: "Pressing Highlight used to dim the whole article until the server sent back every mark on the page. The passage now takes its colour on the first frame, the server still decides the final mark, a second press can't double it, and a refused or stalled save says so in plain words, on the web and in the iPhone app's reader."
excerpt: "The article no longer fades while a highlight saves. The mark is painted on the first frame."
tldr: "Pressing Highlight now paints the passage on the first frame, instead of dimming the article until the server's marks swap in. Readplace still writes the record: the instant colour is a preview, a second press while it saves sends nothing, a refusal shows up in plain words with a retry where the passage still reads the same, and a stalled save offers Stop waiting and a Check highlight that reads the answer back without re-sending the write. The iPhone app's reader now shows the refusals it used to drop."
slug: "highlighting-no-longer-dims-the-article"
date: "2026-11-25"
author: "Fayner Brack"
keywords: "instant highlights, highlight web articles, highlight saved articles, annotate while reading, highlight without losing your place, css custom highlight api, read it later with highlights, pocket alternative with highlights, readplace highlights"
---

Until this week, the reader answered a press of Highlight by dimming the whole article.

The dim lasted as long as a round trip. The passage went to the server, the server worked out the final set of marks for the page, and the colour arrived when the answer came back. Marking a sentence meant watching the page fade around it, mid-read.

That order is reversed now. The passage takes its colour on the first frame after the press, a screen reader hears "Saving highlight", and the text stays readable while the request is still on the wire.

What hasn't moved is the authority. The server still decides where the mark really starts and ends, what it overlaps, and the id and note it carries. The instant colour is a preview of that decision, and the rest of this change exists to keep the preview and the record from drifting apart.

> **The first frame shows the press. The record is still written on the server.**

## Painted without touching the page

The preview is a colour the browser draws over the selected range through [the CSS Custom Highlight API](/view/developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API?utm_source=blog-highlighting-no-longer-dims-the-article&utm_medium=internal&utm_content=read-developer-mozilla-org). The article's markup isn't edited to show it. Nothing reflows, and a preview that has to be taken back vanishes without leaving a seam in the page.

When the server answers, its marks replace the preview, measured server-side as before. That caution is old policy: a highlight is stored as its quote with the text around it, which is how [a mark finds its passage again](/blog/highlights-and-notes-stay-on-their-passage?utm_source=blog-highlighting-no-longer-dims-the-article&utm_medium=internal&utm_content=post-highlights-and-notes-stay-on-their-passage) after a recrawl replaces the body. A range measured in the browser is good enough to paint with, and not good enough to store.

## The swap waits for the gesture

An answer that lands while a drag is open in the article holds until the gesture ends, so the final marks don't reshuffle the text under a selection in progress.

A selection made while the save was in flight comes back afterwards, restored by its normalised offsets, and only when the new text agrees with the old. Nothing moves under a finger that is still choosing.

## A second press sends nothing

One create is in flight per reader view, tracked by its own request. Pressing Highlight again while the first save runs sends no second request, so the double press a slow page tends to collect leaves one mark, not a stack of them.

## A refusal arrives as words

A save the server turns down used to be easy to miss, and in the iPhone app's reader it was dropped outright: the mark failed without a word on screen.

The refusal now lands in a small status card, on the web and in that same iPhone view, and it names its cause in plain words: "That passage changed; select it again", or "Select a shorter passage". While the passage still reads the same, the card offers Try again. It carries a Dismiss, and the article behind it has stayed readable the whole time.

## Stop waiting, then ask

A save that goes quiet says so.

The card reads "Still saving this highlight" and offers Stop waiting, which cuts the request off rather than leaving the page to it.

Cutting it off leaves a fair question: did the write land anyway? The card answers with "Readplace may still have saved this passage:" and a Check highlight button. The check is a background read of the reader page, and it comes back 1 of 3 ways: "This passage is highlighted:", "This passage wasn't highlighted when Readplace checked:", or a plain could-not-check when the connection is gone. What it refuses to do is re-send the write. Asking about a highlight can't create one.

## Marking without stopping

A highlight is made in the middle of a sentence that is going well, and that was the worst moment to fade the page.

None of it asks to be switched on. The first-frame paint is in the signed-in reader now, on the same toolbar that opens [a note beside the passage](/blog/a-note-opens-beside-the-passage-it-quotes?utm_source=blog-highlighting-no-longer-dims-the-article&utm_medium=internal&utm_content=post-a-note-opens-beside-the-passage-it-quotes), and the server's half of the work kept its shape.

An article has to be saved before it can be marked, and saving one is the whole job of [readplace.com](/?utm_source=blog-highlighting-no-longer-dims-the-article&utm_medium=internal&utm_content=home).
