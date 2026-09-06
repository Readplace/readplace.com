---
title: "One Email for Every Ready Article, Not Just the First"
description: "Readplace used to email you about the first saved article that turned readable and drop the rest for six hours. Now a single digest, sent at most every 6 hours, lists every article you were waiting on that is ready, each with its title, its site, and the first lines of the clean reader text."
slug: "one-email-for-every-ready-article"
date: "2026-07-05"
author: "Fayner Brack"
keywords: "read it later digest email, article ready notification, reader view ready email, one email not many notifications, batched read later emails, saved article ready email, reading list digest, read later app email overload, Readplace digest, email when article is ready"
tags: ["changelog"]
banner: "I batched the ready-article emails into one digest"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Save several heavy pages, open each while it is still building, then close the tabs. Readplace used to email you about the first page to finish and drop the rest for 6 hours, so you only ever heard about one. It now collects them. Every 6 hours it sends a single digest listing each article you were waiting on that has since turned readable, with its title, its site, and the first lines of the clean reader text. The 6-hour cap still holds, but it bounds the digest now, not the news, so the second and third ready articles arrive in the same email instead of vanishing. What has to be true before it writes you at all did not change: you opened the article and left before it finished, the work ran over a minute, and you have not since read, deleted, or re-saved it.

</div>
</details>

Nothing stops a read-it-later app from emailing you the moment each saved article finishes loading. Readplace stopped itself.

Here is the setup. Readplace emails you when a saved article you were waiting on turns readable. You save a heavy page, glance at it while the clean reader view is still building, and close the tab. When the text and the summary are done, an email brings you back. [The first version of this](/blog/email-when-your-article-is-ready?utm_source=blog-one-email-for-every-ready-article&utm_medium=internal&utm_content=post-email-when-your-article-is-ready) sent one email per article and capped those emails at one every 6 hours, so an inbox would not fill up.

The calm had a price, and the price was the other articles.

## The cap used to drop the other articles

Say five of your saved pages finished within the same afternoon, and you had opened and left all five. The old rule emailed you about the first one to finish. Then the 6-hour slot was taken. The other four were not held for later. They were dropped.

So the limit that kept your inbox calm also kept four ready articles from reaching you. You would open Readplace later and find them done, with nothing having told you. The email you got was true. The four you did not get were what the calm cost.

> **The cap thinned the emails by thinning the news.**

That is the wrong trade. How often to write you is a question about rhythm. It should not double as a question about which articles you are allowed to hear about.

## One email, every article that's ready

The new version keeps the rhythm and changes what rides on it. Instead of emailing about the first ready article and dropping the rest, Readplace holds them. Every 6 hours it gathers the articles you were waiting on that have since turned readable, and sends one email listing all of them.

Five ready articles are five rows in one digest now, not one email and four silences. Each row carries the title, the site it came from, and the first few lines of the cleaned reader text, so you can tell from the email itself which one to open first. A button on each row drops you into that article's reader.

> **The 6-hour limit still holds. It now caps the digest, not the news.**

The number of emails did not go up. What each email carries did.

## How it knows you were waiting

Readplace records two moments for every save: when the reader view finishes building, and when you first open that reader. If the open lands before the finish, you were sitting in front of a loading page. That is the signal the digest runs on. A save you opened only after it was done never enters the readlist, and one you did not open at all does not either.

That is also why the email can trust its own list. Six hours is long enough to read a piece, delete it, or save it again. So each row is re-checked the moment the digest is built, against the live state of that article. A row that no longer holds up is dropped before the email goes out, not after.

## Who still gets nothing

The digest left the rules about writing you at all untouched, because those rules are why the email is worth opening.

It writes only if you opened the article and left before it finished. Stay in the reader until the text lands and you already have it, so you hear nothing. It writes only if the work took more than a minute. A page that resolves in 20 seconds finished while you watched, and needs no nudge. And it drops any article you have since read, deleted, or saved again, checked at the second the digest goes out, so no row points at something you are done with.

Import a thousand links you did not open, and the digest stays empty, because none of them were pages you sat waiting on. The email stays reserved for the case it was built for: a slow page you gave up on, handed back the moment it is ready.

None of this asks anything of your machine. The timing lives on Readplace's servers, so there is no app to install for it, no browser permission to grant, and no script running in the background to watch a tab. The digest goes to the verified address on your account and nowhere else.

A rate limit that drops the news keeps your inbox quiet by keeping you in the dark. One that batches the news keeps it quiet and still names every article that is ready.

Save a slow page from [the browser extension](https://readplace.com/install) or from [readplace.com](/?utm_source=blog-one-email-for-every-ready-article&utm_medium=internal&utm_content=home), glance at it before it settles, then close the tab and let the next digest bring it back.
