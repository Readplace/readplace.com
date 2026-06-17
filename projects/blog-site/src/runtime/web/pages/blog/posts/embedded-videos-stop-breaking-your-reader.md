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

Readplace's reader used to leave a dead box where a native video tag sat in an article. Now each one becomes a short line of text with a link to the original page. This applies to video tags in the HTML, not to YouTube or Vimeo embeds. You read the article clean, and if you want the video, one tap takes you to it on the source site. The fix works for articles in your queue and for any link you open at readplace.com/view.

</div>
</details>

I was reading a saved tutorial on web.dev when I lost my place halfway down, because a black rectangle had pushed the next paragraph clean off the screen and I had to scroll to find where I had been.

The rectangle was a `<video>` tag the site had written into its HTML, and in our reader it sat there showing nothing.

So I tried a few more saves to see how common it was. A recipe post left a spinning loader where the cooking clip should have been, and a product review left an empty grey box that shoved two paragraphs down the page every time I scrolled back to it. Same shape each time, same dead box.

I went looking for the reason the player would not start, and it traced back to a setting I had turned on myself.

Now an embedded video does not leave a dead box. In its place you get one short line of text with a link to the original.

## Why the player would not start

The reader shows your article inside a sandboxed frame with scripts switched off, which is the rule I had set so the page loads fast and stays clean, and it turned out to be the reason the video had no chance.

A native video tag, the kind a site writes straight into its HTML, leans on JavaScript to start playback or to fetch the file late.

With scripts off, none of that runs. The saved copy had a `<video>` element and nothing to put inside it.

YouTube and Vimeo embeds were not the problem here, because they load inside their own iframe and the reader already strips those out before you ever see the article. The dead boxes I kept hitting were all native video tags.

So the tag sat in the frame with nothing to show, took up space, and gave you nothing to watch. Worse, an empty player can push the next paragraph down the page and break your place mid-read, which is the exact thing that happened to me on that first tutorial.

## What replaced the dead box

The fix turns each video tag into a small callout, framed with a thin border and a brand-colour edge.

It reads something like "Watch this video on web.dev →", and the site name is the link. Tap it, and the original page opens with the video ready to play.

The text around the callout stays put.

You read the paragraph before the video, then the one after it, with no broken player wedged in between, and when I went back to that tutorial after the change the article held its shape and my eyes kept their line straight down the page.

> **A video you cannot play in the frame is just a gap in the page, so the reader marks the spot and points you to the real thing.**

## The video is still one tap away

You do not lose the video.

If a clip matters to the piece, the link sends you straight to it on the source site, and you decide whether to watch. The reader just stops the empty box from breaking the flow of the words.

This sits next to how the reader already handles pictures and text, where it keeps what helps you read and trims what gets in the way, and the video tag was the one piece that broke both of those at once. So it gets a link instead of a box.

## It follows the article wherever you read

The callout travels with the article.

Open something from your queue and it is there. Paste a fresh link at [readplace.com/view](/view) and it shows up in that clean reader too. Share a view link with a friend, and they read the same tidy version, video link included, with no account needed.

The 3 saves that first tripped me up were a tutorial, a recipe, and a product review, and those are the kinds of pages where this shows up most, since they lean on embedded clips to carry a point the text could make on its own. The words still hold. Now the clip sits one tap behind a link instead of blocking the page.

## Try it

Find an article you saved that had a video in it, or paste a fresh link at [readplace.com/view](/view). For a quick example, try [web.dev's guide to video and source tags](/view/web.dev/articles/video-and-source-tags). Read it clean, and tap through to the video only if you want it. Start at [readplace.com](/).

The lesson I took from this: when a feature you turned off elsewhere leaves an empty hole, do not leave the hole. Mark the spot and hand the reader a way to the real thing.
