---
title: "Save PDFs Straight From Your Browser, Even the Blocked Ones"
description: "Some PDFs sit behind bot protection or a login, so crawlers get turned away. Readplace now reads the PDF from your own browser tab and saves a clean copy to your queue. Open it in your browser, and you can save it."
slug: "save-pdfs-straight-from-your-browser"
date: "2026-06-06"
author: "Fayner Brack"
keywords: "save pdf, read it later pdf, save pdf to read later, save pdf browser extension, save login pdf, bot protection, cloudflare block pdf, ocr pdf, save scanned pdf, readplace"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Readplace can now save a PDF straight from your browser. Open the file in a tab, click save in the extension, and the extension reads the bytes from that tab. The request carries your own session, so sites that block crawlers still let the file through. Readplace reads the text, runs OCR on scanned pages, and drops a clean copy into your queue. HTML articles save the same way as before.

</div>
</details>

A file you can open should be a file you can save. For most PDFs it works that way. The trouble starts with the ones a website hands to you but refuses to hand to anyone else.

Take a scanned court filing on a site that screens its visitors. You click the link, the PDF loads in your tab, you read it. Then you click save and your reader comes back empty-handed, because the site looked at whatever fetched the file and decided it was a bot.

A read-it-later crawler arrives from a data center as a stranger. Services like Cloudflare and Fastly read its fingerprint and return a block page in place of the file.

Readplace now reads the PDF from your own browser tab, the one place the site already trusts.

Open the file in your browser, click save in the extension, and the extension grabs the bytes out of that tab and sends them up. The request rides on your session and your real browser, so the site treats it as the visit it already allowed.

> **If you can open the PDF in your browser, Readplace can save it.**

## How the save works

The extension keys off one signal. A PDF tab is not a web page, so the usual text capture comes back empty, and that empty result is the cue to fetch the raw bytes from the tab and upload them as a file.

On the server, Readplace skips the download step it would run for a normal link. It points its PDF reader at the bytes you sent, takes no second trip to the website, pulls out the words, runs OCR on scanned pages, and saves a clean copy to your list.

No fresh request to the origin means nothing for the site to block.

## What changes for you

The files that used to fail most are the ones this fixes. Scanned documents, papers behind a campus login, reports on sites that turn scrapers away. They now save with one click, and the article lands in your reader with its title and text in place.

Your everyday saves stay exactly as they were.

HTML articles take the same path as before, because the browser only grabs bytes for a file it cannot read as a page. A normal article save is still a normal article save.

The upload handles files up to 500 MB, which covers all but the heaviest scans.

## Why grab the bytes from your browser

To a defended website, a server-side crawler and your browser are not the same caller, and the site decides per request. The crawler runs from a data center with a TLS fingerprint that bot protection learns to flag. Your browser runs from your machine, carrying your cookies and a fingerprint the site has already cleared.

So the same PDF that blocks a crawler opens for you, and Readplace borrows that trust for the one save. It reads the file you already loaded instead of asking the site for a copy it would refuse.

## Try it

Find the PDF your old app gave up on. Open it in your browser, then click save in the Readplace extension, and watch it land in your queue with the text pulled out for search and reading.

[Install the browser extension](https://readplace.com/install) or start at [readplace.com](/).
