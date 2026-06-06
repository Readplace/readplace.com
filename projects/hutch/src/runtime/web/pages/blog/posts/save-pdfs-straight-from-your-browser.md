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

You find a PDF worth reading. A research paper, a court filing, a scanned manual. You click save, and your reader gives up. The file opens fine in your browser, so the failure makes no sense.

Plenty of PDFs sit behind bot protection or a login. A read-it-later crawler arrives as a stranger from a data center. Services like Cloudflare and Fastly read its fingerprint and send back a block page in place of the file. The crawler never sees the PDF you can see.

Readplace now takes a different route for these files. It reads the PDF from your own browser. Open the file in a tab, click save in the extension, and the extension grabs the bytes from that tab. The request carries your session and your real browser, so the site treats it as a normal visit. Those bytes go straight to Readplace.

The rule is short. If you can open the PDF in your browser, Readplace can save it.

## How the save works

The extension watches for one signal. A PDF tab is not a web page, so the usual text capture comes back empty. That empty result tells the extension to fetch the raw bytes from the tab instead. It sends them up as a file upload.

On the server, Readplace skips the download step. It runs its PDF reader on the bytes you sent, with no second trip to the website. The reader pulls out the words, runs OCR on scanned pages, and saves a clean copy to your list.

## What changes for you

This helps with the files that used to fail most. Scanned documents, papers behind a campus login, and reports on sites that turn away scrapers now save with one click. The article lands in your reader with its title and text in place.

Your everyday saves do not change. HTML articles take the same path as before. The browser only captures bytes for a file it cannot read as a page, so a normal article save stays a normal article save.

The upload handles files up to 500 MB, which covers all but the heaviest scans.

## Why grab the bytes from your browser

A server-side crawler and your browser look different to a defended website. The crawler runs from a data center, with a TLS fingerprint that bot protection learns to spot. Your browser runs from your machine, with your cookies and a fingerprint the site already trusts.

So the same PDF that blocks a crawler opens for you. Readplace borrows that trust for the one save. It reads the file you already loaded, rather than asking the site for a fresh copy it would refuse.

## Try it

Find the PDF your old app refused to save. Open it in your browser, then click save in the Readplace extension. Watch it land in your queue, clean and readable, with the text pulled out for search and reading.

[Install the browser extension](https://readplace.com/install) or start at [readplace.com](/).
