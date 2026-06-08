---
title: "Embedded Videos Stop Breaking Your Reader"
description: "Readplace's reader used to leave a dead video box mid-article. Now each embedded video becomes a short link to the source, so you read the text clean and tap through to the video only if you want it."
slug: "embedded-videos-stop-breaking-your-reader"
date: "2026-06-07"
author: "Fayner Brack"
keywords: "reader view, remove autoplay video, read article without video, distraction-free reader, embedded video placeholder, clean reader, read it later, video link, readplace"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Readplace's reader used to leave a dead box where a native video tag sat in an article. Now each one becomes a short line of text with a link to the original page. This applies to video tags in the HTML, not to YouTube or Vimeo embeds. You read the article clean, and if you want the video, one tap takes you to it on the source site. The change works for articles in your queue and for any link you open at readplace.com/view.

</div>
</details>

You open an article to read it. Halfway down sits a video box that will not play. Sometimes it is a black rectangle. Sometimes it is a loader that keeps spinning. Either way, the words you came for now have a hole in the middle.

Readplace fixes that in the reader. Embedded videos no longer leave a dead box in your article. In their place you get one short line of text with a link to the original.

## The video could not play in the reader anyway

The reader shows your article inside a sandboxed frame. Scripts stay off, so the page loads fast and stays clean. This matters for native video tags, the ones a site writes directly into its HTML. YouTube and Vimeo embeds work differently — they load inside their own iframe, and the reader already strips those. Native video tags need scripts to start or fetch the file late through JavaScript, so the saved copy has nothing to play.

So a native video tag in the reader had nothing to show. It took up space and gave you nothing to watch. Worse, an empty player can shove the next paragraph down the page and break your place mid-read.

## What you see now

Each video in a saved article turns into a small callout, framed with a thin border and a brand-colour edge. It reads something like "Watch this video on web.dev →", and the site name is a link. Tap it, and the original page opens with the video ready to play.

The text around the callout stays put. You read the paragraph before the video, then the paragraph after, with no broken player between them. The article keeps its shape, and your eyes keep their line.

## The video is still one tap away

You do not lose the video. If a clip matters to the piece, the link sends you straight to it on the source site. You decide whether to watch. The reader just stops the empty box from breaking the flow of the words.

This pairs with how the reader already handles pictures and text. It keeps what helps you read and trims what gets in the way. A video you cannot play in the frame is not content, it is a gap, so the reader marks the spot and points you to the real thing.

## It works wherever you read

The same behaviour follows the article. Open something from your queue and the callout is there. Paste a fresh link at [readplace.com/view](/view) and it shows up in that clean reader too. Share a view link with a friend, and they read the same tidy version, video link included, with no account needed.

That matters for the articles people actually save. Recipe posts, product reviews, news explainers, and tutorials lean on embedded clips. The text still carries the point, and now the clip sits one tap behind a link instead of blocking the page.

## Try it

Find an article you saved that had a video in it, or paste a fresh link at [readplace.com/view](/view). For a quick example, try [web.dev's guide to video and source tags](/view/web.dev/articles/video-and-source-tags). Read it clean, and tap through to the video only if you want it. Start at [readplace.com](/).
