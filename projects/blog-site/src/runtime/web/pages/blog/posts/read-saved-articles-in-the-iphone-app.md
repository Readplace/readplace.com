---
title: "The iPhone Reader That Kept Loading a Login Screen"
description: "The Readplace iPhone app now opens a saved article inside the app, the clean reader and the AI summary, instead of sending you to the source site. Swipe marks an article read and keeps it. Getting the in-app reader to open as you took a server endpoint that trades the app's sign-in token for the session cookie the web reader trusts."
slug: "read-saved-articles-in-the-iphone-app"
date: "2026-06-24"
lastModified: "2026-07-26"
author: "Fayner Brack"
keywords: "read it later iphone app, read saved articles in app, in-app reader iOS, swipe to mark as read, read clean version not source site, AI summary iphone, Readplace iOS app, read it later app iphone, mark as read keep article, read saved copy not original page"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Tapping a saved article in the iPhone app used to send you out to the original website, login walls and pop-ups and all. Now it opens the clean Readplace reader and the AI summary inside the app, off your saved copy. Swiping a row marks the article read and keeps it, instead of deleting it. Getting the reader to open as you took a small server endpoint that trades the app's sign-in token for the session cookie the web reader trusts, plus a short script so the reader's own Mark as read reaches the app around it. The iPhone app is on the App Store, at [readplace.com/install](https://readplace.com/install?client=iphone).

</div>
</details>

The reader opened to a login screen inside the iPhone app. The tap had landed on a real saved article, the kind the app had been listing all along, and the page that loaded asked me to sign in to the account I was already signed in to.

This started with two lines of TestFlight feedback. A tester wrote that he liked swipe to mark as read more than a delete button, because articles he finished would stay around for reference. Then he asked the harder one. Could the app show the Readplace version and the summary, rather than send him out to the original website?

Both were fair asks. One was a morning's work. The other took a server change, a web view, and a couple of days of finding out what the app could not see.

## The easy half

Swipe to mark as read replaced the old swipe to delete. Marking an article read keeps it. The row leaves the unread list and the article stays saved, so a finished piece is still there when you go looking for it again. The list holds its place too. The old delete dropped you back to the first page, and the new mark-as-read leaves you where you were reading.

That part shipped without much fuss. The reader is where it got interesting.

## A page the app could not open as you

The Readplace reader is a web page the site already serves, at a private address for each saved article. Open it signed in and you get the clean text and the summary. Open it signed out and you get a login form. That signed-in page is the one I wanted the app to show.

The app could not show it as you. The web reader trusts a session cookie, the small token a browser keeps after you log in. The iPhone app does not sign in that way. It carries an OAuth bearer token, the kind that rides in a request header, not a cookie. So when the web view loaded the reader, it arrived with no session the page recognised, and the page did the one thing it does for a stranger. It showed the login screen.

> **The app held a bearer token. The reader page only trusted a cookie.**

My first try was the simplest in-app browser Apple hands you, the one most apps drop in for a quick web page. It runs in its own sandbox, out of the app's reach, and it will not let the app pass it a cookie or watch what it loads. For a page behind a login the app already holds the keys to, that sandbox is a wall. I moved to the lower-level web view instead, the one the sign-in flow already used, because it lets the app reach into the cookie store before the first request goes out.

## Trading one token for the other

The fix was a small server endpoint that swaps one credential for the other. The app posts its bearer token to it. The server checks the token, mints a session, and hands back the cookie the reader wants. No new power changes hands, because the bearer already authorised the whole API. The grant just arrives in the shape the web page reads.

The app asks for that cookie once, drops it into the web view's cookie store, and only then loads the reader. The page comes up as you. The background requests that fill in the summary stop bouncing to the login screen, because they carry the same cookie now.

So the reader worked. Then I marked an article read from inside it, and the list behind the reader did not move.

## The button that made no sound

The reader has its own Mark as read control. Tapping it did the right thing on the server. It told the app nothing.

The app knows what the web view is up to by watching it move from page to page. Mark as read is not a move. It is a small request that swaps one piece of the page in place and changes no address. To the part of the app watching for navigation, marking an article read looked like nothing at all happened. The reader updated itself and the app stayed blind to it.

I closed that gap with a short script injected into the page. It listens for the swap the reader makes when you mark an article read, cancels it so the underlying list does not flash on screen, and posts a message back to the native code. The app catches the message, closes the reader, and drops the row. The gesture inside the web page reaches the app around it.

## What the app does now

Tap a saved article and the clean Readplace reader opens in the app, the summary with it, off the copy on Readplace's servers. View original is still one tap away inside the reader, for the times you want the source. Swipe a row and the article is marked read and kept, not thrown out.

A tester sent two sentences about how he wanted to read. They turned into two gestures, a tap that opens your own copy and a swipe that files it away, with a credential trade and an injected listener underneath holding both up.

If you are already on [the iPhone app](/blog/read-it-later-iphone-app), the reader you tap into now shows your saved copy, the same clean text and summary the web reader serves. The app is on the App Store, and the install page has it at [readplace.com/install](https://readplace.com/install?client=iphone).
