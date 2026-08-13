---
title: "The Share Sheet That Left Out Every PDF"
description: "Sharing a PDF from an iPhone used to skip Readplace, because the app was missing from the share sheet for any PDF. Fixing how the share extension declares what it accepts brings it back for Safari's viewer, Files, and mail attachments, and it uploads the file's bytes directly so a PDF behind a login still saves."
slug: "save-pdf-from-iphone-share-sheet"
date: "2026-07-03"
lastModified: "2026-07-26"
author: "Fayner Brack"
keywords: "save pdf from iphone, save pdf to read later iphone, share pdf to read it later, iphone share sheet pdf, save safari pdf ios, read pdf later app iphone, save pdf behind login, ios share extension pdf, save mail attachment pdf, readplace iphone"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

On an iPhone, a PDF was the one thing you could not hand to Readplace. Open a PDF in Safari, in Files, or as a mail attachment, tap share, and Readplace was missing from the row of apps. That was a bug in how the app told iOS what it accepts, not a choice. The share extension now declares PDFs too, so it shows up for them, and it uploads the file the share sheet already holds instead of fetching it again. That last part matters for a PDF behind a login: the app sends the bytes it was handed, so a file a crawler would be blocked from still saves. One limit stayed. A PDF shared straight from Files, with no web address behind it, reports no link to save, because Readplace files articles by their URL. The iPhone app is on the App Store.

</div>
</details>

Every app in the iPhone share sheet has to declare what it accepts. Readplace's declaration named web pages and plain text. It left PDFs off, so sharing a PDF from Safari did not show Readplace in the list at all.

I found the gap the way these gaps usually turn up. I opened a PDF in Safari, tapped share, and went looking for Readplace. It was not there. The web page in the next tab shared fine, so the extension itself worked. The PDF was the one thing it would not take.

## Why iOS hid the app

iOS decides which apps show in the share sheet by matching what you are handing it against a rule each app ships. Readplace's rule was a short list with two entries: a web address, and some text. A PDF is neither. It arrives as a file, tagged with the type `com.adobe.pdf`.

The part that caught me out was the knock-on effect. iOS checks the whole of what you share against the rule, and if any piece of it is a type the app did not list, it drops that app from the sheet. So a PDF did not simply fail to match a slot. Its presence pulled Readplace out of the running for the share entirely.

> **iOS hides an app that cannot name every part of what you are sharing.**

## The rule that had to change

The short-list form of the rule cannot say "take PDFs and web pages, and nothing else." Adding files to that form at all waves through every file type, which is worse than the gap I started with. So I moved the rule to the other shape iOS allows, a small query written as a predicate.

The new rule names three things it will take: a web address that is not a file, text that is not a file, and a PDF. I checked it by running the real iOS predicate against 16 shapes of shared payload, the actual forms a share can arrive in, so a stray type could not push an icon into the sheet or out of it where it should not go.

## Sending the file it already holds

Showing up for a PDF was half of it. The other half was what to do once the share sheet handed one over.

For a web page, the app loads the address in a hidden browser view and captures the cleaned page. A PDF needs none of that. It is already the finished document, and the share sheet passes the app its bytes directly. So the app uploads those bytes as they are and skips the browser view. No render, and no second trip to the site the file came from.

That second trip is the one worth avoiding. The same idea runs in the [browser extension I wrote about when it started saving PDFs from your own tab](/blog/save-pdfs-straight-from-your-browser): a PDF behind a login or a bot check is one a crawler asks for and gets a block page instead of the file. The phone already has the bytes. Sending the ones it was handed means the save does not ride on a fresh request the site can refuse.

> **The app sends the file it already has, so a PDF a crawler would be blocked from still lands in your queue.**

Before it sends anything, the app reads the first few bytes for the marker every PDF opens with, so a mislabelled file does not go up as one. If that check fails, or the PDF runs past the 25 MiB the extension will carry, it falls back to sending the link alone and lets the server crawler fetch it, which allows far larger files.

## The PDF with no link

One case still comes back empty, and that one is on purpose. Share a PDF straight out of the Files app, with no web page behind it, and Readplace tells you it found no link to save.

Readplace files every article under its web address. A loose PDF sitting in Files has none, so there is nothing to file it under. Open the same PDF from a web page and it carries that page's address, and it saves. The file with no origin is the edge that stays open, and closing it is a separate piece of work.

```rp-figure
kind: rule
title: What the phone sends when you share
note: Pick what you are handing over; the first clause that matches decides it.
choice: What you hand the share sheet | A web page | A PDF that came off a web page | A PDF straight from Files
choice: Size of the PDF | Up to 25 MiB | Past 25 MiB
flag: The extension still declares only web pages and plain text
flag: The first bytes are not the marker every PDF opens with
when: c1=1 -> ok | Saves the page | For a web page, the app loads the address in a hidden browser view and captures the cleaned page.
when: f1 -> no | Not in the sheet | iOS hides an app that cannot name every part of what you are sharing, so the PDF pulled Readplace out of the running for the share entirely.
when: c1=3 -> no | No link to save | Readplace files every article under its web address, and a loose PDF sitting in Files has none.
when: f2,c2=2 -> ok | Sends the link | A failed marker check, or a PDF past the 25 MiB the extension will carry, falls back to sending the link alone and lets the server crawler fetch it, which allows far larger files.
else: ok | Uploads the bytes | The share sheet passes the app its bytes directly, so the app uploads those bytes as they are and skips the browser view.
```

So the share sheet now offers Readplace for a PDF wherever one shows up on the phone, from Safari's viewer to a mail attachment to a file that came off a web page. Share it, and the app sends the bytes it was already holding, which is what gets a login-guarded PDF into your queue. The iPhone app is on the App Store, linked from [readplace.com/install](https://readplace.com/install?client=iphone). Put a PDF into it from your phone and open it back in the [in-app reader](/blog/read-saved-articles-in-the-iphone-app).
