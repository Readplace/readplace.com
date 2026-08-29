---
title: "A Reused Session Shouldn't Choose Your Account"
description: "Connect an app to Readplace on a phone and the fastest login binds the approval to whichever account your browser already holds, with no email shown. The consent screen now names that account and gives you a one-tap way to switch to the one you meant."
slug: "switch-accounts-when-connecting-an-app"
date: "2026-07-12"
author: "Fayner Brack"
keywords: "connect app to read it later, sign in with the wrong google account, use a different account readplace, switch google account at login, multiple google accounts sign in, oauth consent wrong account, choose which account an app connects to, read it later account picker, connect browser extension right account, sign in with the account you meant"
tags: ["changelog"]
banner: "I let you pick which account an app connects to"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

With two Google accounts on one phone, work and personal, connecting a reading app should let you say which one it links to. Readplace's fastest login did the reverse. When you sign in on a phone, the browser often reuses a session Chrome already holds, so the consent screen approved that account, printed no email, and gave no way to pick the other one. The screen now names the account it is bound to, "Signed in as", with the email under the app's request, and carries a "Use a different account" link. The link ends this one browser session, clears its cookie, and returns you to the login page with the pending connection preserved, so you sign in as the account you meant and the app still links on the first try. When you switch, Readplace also asks Google to show its own account list instead of auto-selecting its single signed-in account. All of it runs on the server, so the iPhone app, the browser extensions, and an AI assistant connecting over the same screen got it at once, with no new release to ship.

</div>
</details>

The screen that connects an app to Readplace shows two buttons, Approve and Deny. On a phone it used to leave out the one fact those buttons act on, which account the approval belongs to.

That gap came from a convenience. I built the login to be fast, and fast meant reusing a session the browser already had.

## The login that skips the question

When the iPhone app or a browser extension needs a signed-in user, it opens the authorize page in Chrome. Most people read in Chrome and stay signed in there, so Chrome usually holds a live Readplace session already. The page finds that session and treats the visitor as logged in. No password to type and no form to fill, just Approve or Deny.

The reused session carries one account. For a reader with a single account that is the whole point, the login gets out of the way. For a reader with two, work and personal on the same phone, it makes the call for them without asking.

> **A login that skips the password also skips the question of which account you meant.**

## The account the screen wouldn't name

Say a reader's work Google is the one Chrome stays signed into, and the account they keep their own reading under is the personal one. They open the extension to connect it, and the consent screen comes up already logged in as work. It read the reused session and bound the approval to it.

The old screen printed no email at all. It said an app wanted access to a Readplace account and stopped there. Approve or deny were the only moves, and nothing on the page named which of the two accounts was about to be handed over. Approve, and the extension linked to the wrong one. The way back was to go find a sign-out, end the session by hand, and start the whole connection over.

## The link that hands the choice back

The consent screen names the account now. Under the app's request sits a line, Signed in as, and the email of the account the approval would use. If Readplace can't read the email for that session it drops the line rather than guess at it, and the switch below still works.

That switch is a third control under Approve and Deny, marked Use a different account. It does the sign-out a reader used to do by hand, in one place. It ends this browser session, clears the cookie, and returns to the login page. The connection already in progress rides along in a `return` value, so signing in as the other account links the app without retracing a step.

One line in that handler is worth naming. Ending a session is a rough thing to do to a request that might be malformed or hostile, so the code checks the app's redirect address is valid before it touches the session at all. A bad request gets a plain error, not a surprise logout.

It ends this session only. Signing out everywhere would reach the same account on a laptop and another phone, which is not what a reader picking the right account is asking for. The switch closes the session in front of them and leaves the rest alone.

> **Use a different account means leaving this one browser session, not signing out of every device you own.**

## Making Google offer its own list

Clearing the Readplace session is half of a switch. The other half is Google. Back on the login page, a tap on Sign in with Google runs into Google's own idea of who the reader is. If one Google account is signed in on the phone, Google picks it and skips its chooser, which lands right back on the account the switch just left.

So the switch carries a flag, [`prompt=select_account`](/view/developers.google.com/identity/openid-connect/openid-connect), from the login page through to Google. It tells Google to show its account list instead of auto-selecting the single signed-in one. The flag travels only on a switch. A normal login still goes straight through with no extra screen. Apple's button already shows its own switcher, so it needed nothing added.

## One screen, every client

The fix lives on the server, in the page Readplace draws for the consent step. The iPhone app, the Chrome and Firefox extensions, and [an AI assistant connecting over the same OAuth screen](/blog/connect-ai-assistant-without-an-api-key) all read that page from the server. So they got the account line and the switch at the same moment, with no app update to build and nothing to wait on in a review readlist.

That is the payoff of drawing the screen on the server. A client is a thin shell around a page Readplace controls, so a change to the page reaches every client the second it deploys.

## Check which account you're connecting

Next time you link the extension, the iPhone app, or an assistant to Readplace, read the line under the app's name before approving. If it names the account you meant, approve and it is done. If it names the other one, Use a different account sits one tap below, and the connection picks up where it left off after a fresh sign-in. Connect a client from [readplace.com](/) or [the browser extension](https://readplace.com/install), and watch the consent screen say whose account is about to agree.
