---
title: "Readplace for iPhone Is on the App Store"
description: "The Readplace iPhone app has left TestFlight and is on the App Store. Save any page or PDF from the share sheet, read your saved copy with its TL;DR in the app, and sign in without leaving it. It runs on a Mac too. There is still no Android app and no offline reading."
slug: "readplace-iphone-app-on-the-app-store"
date: "2026-07-26"
author: "Fayner Brack"
keywords: "read it later app iphone app store, readplace iphone app, save articles from iphone share sheet, pocket alternative iphone app, ios read it later app, save pdf from iphone, app store read it later app, save to read later ios, best read it later app iphone"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

The Readplace iPhone app was invite-only on TestFlight since June. Apple approved it, so it installs from the App Store like anything else, with no invite and no second app to set up first. What it does has not changed. Share a page or a PDF from any browser on the phone and it saves to your queue in the background, your list is in the app with pull to refresh and a swipe that marks an article read, and tapping one opens your saved copy with its TL;DR instead of the original site. The part that took the longest was signing in. App Store review turned down an earlier build for handing the login to the default browser, so the login now runs inside a sheet the app owns and never leaves. The same app runs on a Mac. What it still does not do: no Android version, no offline reading, and no search or tags. It needs iOS 16 or later, and a Readplace account.

</div>
</details>

Installing the app used to take two apps and an invitation. You installed TestFlight, found the Readplace invite, accepted it, installed the build from there, and opened it once. Five steps before the thing had saved a single article.

Apple approved the app for the App Store. It installs the way an app installs. Search for Readplace, tap Get, open it, sign in.

None of the saving changed, and the saving was always the point. The app exists because [the share sheet is already where your thumb goes](/blog/read-it-later-iphone-app) when you want a page somewhere other than the tab you are in.

## What it does on the phone

Open a page in Safari, Chrome, or whatever browser you use, tap Share, and pick Readplace. The link lands in your queue and renders in the background, so you stay on the page you were reading. [A PDF goes the same way](/blog/save-pdf-from-iphone-share-sheet), and the app uploads the bytes the share sheet handed it rather than asking the site for the file a second time, which is what gets a PDF behind a login into your queue at all.

Your queue is in the app. Pull down to refresh, scroll for more, and swipe a row to mark an article read. Tap one and [the clean reader opens inside the app](/blog/read-saved-articles-in-the-iphone-app) with the TL;DR above the text, off the copy on Readplace's servers rather than the live page. View original is one tap away for the times you want the source.

That is the whole app. Save fast, glance at the list, read what you saved.

## The login that held the release up

The part that took the longest was not saving. It was signing in.

The build I submitted first sent you out to the default browser to log in and waited for iOS to hand you back. It worked. [App Store review](/view/developer.apple.com/app-store/review/guidelines/) rejected it anyway, because a sign-in that leaves the app is a sign-in the app cannot account for.

> **Review did not care that the browser login worked. It cared that the app left to do it.**

Login and Sign up now run in a sheet the app owns, and the callback comes back to the code that asked for it. Nothing about your account changed. The screen just stopped leaving, and there is no server field on it either, which is one fewer thing to get wrong than the beta had.

One related behaviour is worth naming, because you will notice it. When the app opens a readplace.com link that is not a login, it opens in Chrome if you have Chrome. Most people browse in Chrome and never change the iOS default browser setting, which leaves them signed out in Safari and staring at a login form for a page they own. A link to anyone else's site is handed to the system untouched, so your default browser stays your default browser everywhere it matters.

## What it still does not do

The app is built for iPhone, and the same build runs on a Mac. There is no Android app at all.

There is no offline reading. Every screen needs a connection, so a saved article will not open in a tunnel or on a plane. That is the gap I hear about most.

There is no search and no tags in the app, because there is no search or tags in Readplace yet, on any surface.

It needs iOS 16 or later, and it needs a Readplace account. The download is free, the account starts as 14 days with no card, and Readplace is $49 a year after that.

## Put one article in it

If you were in the TestFlight beta, the App Store build is the one to keep. Your queue lives on the server, so there is nothing of yours inside the app to lose.

Install it, then share the next thing you were going to get to later from whatever browser you already have open, and read it back in the app when the evening is quieter than the afternoon was. Both are covered on [the install page](/install?client=iphone), and everything starts at [readplace.com](/).
