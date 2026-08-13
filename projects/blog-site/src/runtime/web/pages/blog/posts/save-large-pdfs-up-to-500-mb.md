---
title: "The File That Was Too Big to Save"
description: "Readplace used to cap a saved file at a few megabytes and send anything larger to a slow path by email. It now takes PDFs up to 500 MB by handing the browser a one-time upload address straight to storage, then checking the staged file before it counts as saved."
slug: "save-large-pdfs-up-to-500-mb"
date: "2026-07-17"
author: "Fayner Brack"
keywords: "save large pdf read it later, read it later pdf size limit, save big pdf to read later, save 500 mb pdf, read it later app large files, save scanned pdf read later, upload large pdf to reader, save big file read it later, read it later no file size limit, save a textbook pdf to read later"
tags: ["changelog"]
banner: "I raised the ceiling on how big a file you can save"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Most read-it-later tools keep the files you can save small, because a single web request can only carry so much. Readplace used to do the same. Anything past about 3 megabytes had no direct save and went to a slower path by email. A big file rides a different route now. When it is too large for the request, Readplace hands the browser a one-time upload address that points straight at storage, the file goes there directly, and the request-size limit stays out of it. The ceiling is 500 megabytes for a PDF, up to 300 pages for the read that follows, and 40 megabytes for a web page's HTML. Before a staged file counts as saved, Readplace checks it: the right size, recently uploaded, and starting with the five bytes every PDF starts with. A file that fails any of those is refused, not kept. The browser extension carries the same route, so a heavy capture no longer stops at the old few-megabyte cap. Small saves are unchanged, still going straight through in one request.

</div>
</details>

How big is a book once it is scanned to a PDF? Often 80 to 200 megabytes, and not one of those megabytes is text a computer can read yet.

A court filing with its exhibits runs larger. Conference proceedings, a scanned reference, a year of a newsletter exported in one file, all of them clear the size a single web request is built to carry. For a while, saving one of those to Readplace meant not really saving it. The file had no direct route in, and the way around it was slow and ran through email. You sent it off and waited on a person.

A copy you can't make is not a copy. A read-it-later tool that only holds the small files is missing the ones you most want held: the long report, the scanned textbook, the document someone sent you that you can't find twice.

## The request that can only carry so much

When you save a page, the file travels inside one web request to a small server that runs only for the length of the save. That kind of server, [a Lambda function](/view/docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html), caps a single request at 6 megabytes. Room for the rest of the request comes out of that, so Readplace advertised a budget near 3 megabytes for the file itself.

Under the budget, the save goes straight through, and it still does. Over it, the file had nowhere to go. The only answer was the slow path Readplace keeps for anything above the caps, [handled by email](/blog/import-page-findable-in-search) rather than saved on the spot.

So the size of one web request set the size of what you could keep. A limit built into the plumbing became a limit on the product.

## A one-time key straight to storage

A big file doesn't need to travel inside the request. It needs a place to land and a way to reach it. So over the budget, Readplace mints one: a [presigned upload address](/view/docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html), a single-use key that points straight at storage and expires in 15 minutes.

The browser sends the file's bytes to that address on its own. The request-size cap doesn't apply, because the file no longer rides the request. Readplace hands out the key, the file lands in storage, and the save picks up from there.

One small thing had to be exactly right. Readplace mints the key to carry no content checksum of its own, because a checksum computed for an empty body makes every real upload fail with a bad-digest error. Miss that, and nothing over 3 megabytes saves at all.

> **A file over the budget doesn't ride the request. It gets a key and goes to storage on its own.**

## Checked before it is kept

A key that points at storage is a key that could be pointed at the wrong thing. So a staged file is not trusted on arrival. Before it counts as saved, Readplace reads the object back.

The size has to match what was uploaded. The write has to be recent, measured against a window twice the key's own life — about 30 minutes — so a big file whose upload ran long still counts, while a stale write left from an hour ago does not. And the file has to actually be a PDF, which Readplace tests by reading the five bytes every PDF opens with, `%PDF-`.

A staged object that misses any of those checks is refused. The check sits on the server, past the browser, so a request that skips the page and posts straight at the route answers the same questions. Nothing lands in your queue on the strength of a key alone.

```rp-figure
kind: rule
title: What decides whether a file counts as saved
note: Under the budget the file rides the request; over it, the staged object is read back first.
choice: What you are saving | Under the 3 MB budget | A 200 MB scanned book | A 500 MB PDF, 300 pages
flag: The staged size doesn't match what was uploaded
flag: The write is older than the roughly 30-minute window
flag: The bytes don't start with %PDF-
when: c1=1 -> ok | Saved | Under the budget, the save goes straight through, and it still does.
when: f1 -> no | Refused | The size has to match what was uploaded.
when: f2 -> no | Refused | The write has to be recent, measured against a window twice the key's own life, about 30 minutes.
when: f3 -> no | Refused | The file has to actually be a PDF, tested by the five bytes every PDF opens with, %PDF-.
else: ok | Saved | Over the budget the file doesn't ride the request: it gets a one-time key straight to storage, and the read-back finds nothing wrong.
```

## The ones you most want held

The ceiling now is 500 megabytes for a PDF, up to 300 pages, which covers the scanned book, the filing, and the proceedings. A web page's HTML gets 40 megabytes, well past the length of any article. Once a big PDF lands, it goes through [the same read a small one gets](/blog/pdf-ocr-pipeline-tesseract-llm-hybrid), turning scanned pages into text you can read and search.

[The browser extension](/blog/save-pdfs-straight-from-your-browser) takes the upload route too. A heavy capture straight off a tab now travels the same road, up to half a gigabyte, instead of stopping at the old few-megabyte cap. It keeps the extension awake through the upload so a slow file finishes rather than dies partway.

A read-it-later tool earns its place by holding what you put in it, [longer than the page you took it from](/blog/saved-articles-outlast-the-original-page). That promise breaks at the first file too big to accept. And the file you turn away is often the one you needed a copy of most, because it was long, or scanned, or already hard to find the first time.

> **The file a tool can't accept is usually the one you most needed a copy of.**

## Save the file that used to bounce

Find the PDF that was too big last time, the report or the scan you routed to email or gave up on. Point [the browser extension](https://readplace.com/install) at it, or drop its link into [readplace.com](/), and it saves on the first try instead of the fifth workaround.

The small file and the 300-page scan take the same two words from you now: save it. What happens under them is different, and that difference is the point. The size of the thing you keep stopped being the size of a web request.
