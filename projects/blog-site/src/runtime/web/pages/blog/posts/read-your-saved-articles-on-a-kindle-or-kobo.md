---
title: "Read your saved articles on a Kindle or Kobo"
description: "Every saved article now has a Download EPUB button, for everyone, with no setting to turn on. The file carries the article's text, its images, and its TL;DR as the opening page, so what lands on your e-reader is the same thing the web reader shows. Public /view pages have the button too, so a shared link needs no account."
slug: "read-your-saved-articles-on-a-kindle-or-kobo"
date: "2026-09-12"
author: "Fayner Brack"
keywords: "download article as epub, read it later epub export, send saved articles to kindle, save articles to kobo, epub download read it later, export saved article epub, e-reader read it later, offline reading epub, readplace"
tags: ["changelog"]
banner: "I gave your saved articles a way onto your e-reader"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Tap Download EPUB in the reader and a file lands on your device. It carries the article's text, its images, and its TL;DR as the opening page, so an e-reader shows the same thing the web reader does. The button is on a public /view page too, which means a link someone sent you downloads without an account. Readplace used to keep a saved article inside Readplace. The article can leave now.

</div>
</details>

Saving an article moves it off an open tab and into a service. It does not move it onto the thing many people actually read on, which is a 6-inch e-ink screen with a browser nobody would choose to use.

The reader toolbar has a Download EPUB button now. It is there for everyone, on every article that has finished crawling, with nothing to switch on.

## An article, not a printout

The file is not a text dump with the pictures thrown away.

It opens on a title page: the article's title, the site it came from, and its excerpt. If the TL;DR has landed by the time you download, it sits directly under that as its own section, ahead of the body. Then the article itself, with the images written into the file rather than pointing back at a server your e-reader may have no way to reach.

> **A file that drops the images and the summary is not the article. It is the text of the article.**

That matters because of where the file is going. An e-reader on a plane has no network, and a linked image is a grey box. The images ride along until 3.5 MB of them have gone in, and anything past that is left out rather than building a file too large to email to yourself.

The name is the article's title, slugged: `how-google-sold-its-engineers-on-management.epub`. Your e-reader's library shows the title, not a hash.

## Built at the moment you press it

There is no stored file sitting in a bucket waiting for you. The EPUB is assembled from the article's current content and its current summary, in the request that asks for it.

Two things follow from that, and both are the reason it works this way.

The first is that a re-crawl reaches the file. When a site fixes a broken page and Readplace picks the change up, the next download is the corrected article. A file generated once at save time would have frozen the broken version and quietly handed you that copy a year later.

The second is that downloading early gets you less. Crawling finishes before summarising does, so an article grabbed in the first few seconds after saving arrives with the site's own excerpt on the title page and no TL;DR section, because there is not one yet. Wait for the summary to appear in the reader and the same button gives you a file that has it. Nothing fails and nothing warns you, so it is worth knowing which one you are taking.

## What your e-reader does with it

A Kobo, a Boox, or a PocketBook takes an EPUB the direct way. Plug it in over USB, copy the file across, and it appears in the library.

A Kindle is the odd one out. Amazon has accepted EPUB through Send to Kindle since 2022, by email or through the app, and converts the file on the way in. Dragging an EPUB onto a Kindle over USB still does nothing, which is a rule Amazon owns and not one I can route around.

So the honest shape of this: one copy for most e-readers, one email for a Kindle.

## The link works without an account

The download lives on the article's public `/view` page as well as in your own reader.

That is the same page a shared Readplace link opens, so someone you sent an article to can take the EPUB without signing up. It is one button on a page that was already public, and it keeps the property the rest of `/view` has: the thing you can read, you can also keep.

## Start with the longest one in your list

The article this helps most is the one you keep scrolling past. A 40-minute piece loses to a phone in a queue and wins on a device with nothing else on it.

Open the longest thing in [your readlist](/queue?utm_source=blog-read-your-saved-articles-on-a-kindle-or-kobo&utm_medium=internal&utm_content=readlist), press Download EPUB, and put it somewhere your phone cannot interrupt it. If you have not saved anything yet, [readplace.com](/?utm_source=blog-read-your-saved-articles-on-a-kindle-or-kobo&utm_medium=internal&utm_content=home) takes a pasted link.

A saved article that can only be read in a browser tab is still waiting on the browser. One that lands on your e-reader as a file is finally somewhere you will read it.
