---
title: "A New Password Now Signs Out Every App the Old One Let In"
description: "Changing a Readplace password now disconnects the browser extension, the iPhone app and connected AI assistants, and signs out every other browser. The screen the change was made from stays signed in. A reset from the forgot-password email keeps nothing."
excerpt: "A new password now reaches every app, extension and assistant the old one let in."
tldr: "Changing a password used to change less than it promised, since apps that signed in under the old one kept their access. Readplace now ends that access in the same press: a password change signs out every other browser and disconnects the browser extension, the iPhone app and any connected AI assistant, keeping only the screen the change was made from. A reset from the forgot-password email keeps nothing at all, so a password that may have leaked takes every signed-in surface down with it."
slug: "password-change-signs-out-every-app"
date: "2026-10-18"
author: "Fayner Brack"
keywords: "change password sign out all devices, password change revoke sessions, does changing password log out other devices, revoke access connected apps, password reset sign out everywhere, oauth token password change, read it later security, readplace"
tags: ["changelog"]
banner: "A changed password now cuts off every app the old one let in"
---

3 kinds of app can hold a key to a Readplace account: the browser extension, the iPhone app, and any AI assistant connected to the reading list. Each one asks for the password once, takes a token, and stops needing the password from then on. The token is what opens the door every day after.

So a password change used to have a short reach. The account accepted the new password and signed out every other browser, and the tokens kept working as if nothing had moved. The extension went on saving pages, and an assistant connected months ago went on answering questions about the readlist, both on a key minted under the password that was just retired.

> **A password only guards the doors that still ask for it.**

This week the change caught up with the tokens.

## The change became a sweep

Changing the password now revokes every connected app's access in the same press. The browser extension, the iPhone app and connected AI assistants are disconnected on the spot, and each asks for a sign-in with the new password the next time it reaches for the account. Other browsers are signed out as before. The success line on the account page names the result: "Other browsers were signed out and your other connected apps were disconnected."

The page says so before the form is sent, too. The lede under "Change your password" states what a change disconnects, so the sweep is a stated rule rather than a surprise, and [the privacy page](/privacy?utm_source=blog-password-change-signs-out-every-app&utm_medium=internal&utm_content=privacy) carries the same statement.

## The screen in use stays signed in

The sweep spares one place on purpose: the one the change was made from. A new password typed into the iPhone app keeps the iPhone app connected, instead of signing out the screen it was just typed into. A change made on the web keeps that browser's session the same way. The page wording follows the rule and promises to disconnect "your other connected apps", because the one in hand is not on the list.

## A reset keeps nothing

The forgot-password email runs a harder version of the same sweep. A finished reset signs out every browser and disconnects every connected app, the one the reset ran in included. The confirmation page lists the cut: "Every browser was signed out, and the browser extension, the iPhone app, and AI assistants were disconnected. Sign in with your new password."

The difference is deliberate. A change starts by asking for the current password, which proves the old one is still known and still yours, so the screen it came from gets to stay. A reset exists for the day the password is forgotten, or may not be yours alone, and under that doubt no signed-in screen earns a pass.

```rp-figure
kind: rule
title: What stays signed in after the password moves
note: 2 things decide the sweep: whether the password was changed or reset, and where that happened.
choice: What happened to the password | Changed from the account page | Reset from the forgot-password email
choice: Where it happened | In a web browser | Inside the iPhone app or a browser extension
when: c1=2 -> no | Nothing stays signed in | A reset exists for the day the password may not be yours alone, so every browser is signed out and every connected app is disconnected, wherever the reset ran.
when: c2=2 -> ok | The app in use stays | A change made inside the iPhone app or an extension keeps that app connected. Every other browser and every other connected app asks for the new password.
else: ok | That browser stays | A change made on the web keeps the browser it was typed into. Other browsers are signed out, and the browser extension, the iPhone app and connected AI assistants are disconnected.
```

## Saved reading does not move

The sweep ends sessions and tokens, and it touches nothing else. Saved articles, readlists and read states stay as they were, and reconnecting an app is the same sign-in it made on day 1. Disconnecting a single app without changing the password also still works, under [Connected apps](/account?utm_source=blog-password-change-signs-out-every-app&utm_medium=internal&utm_content=connected-apps#connected-apps) on the account page.

Time away is still forgiven, too. An untouched sign-in lasts through [6 months of idleness](/blog/still-signed-in-after-a-month-away?utm_source=blog-password-change-signs-out-every-app&utm_medium=internal&utm_content=post-still-signed-in-after-a-month-away), and that rule stands. Idle time ends no sign-in, and a moved password now ends the ones the old password let in.

## Due for a change anyway

A breach notice naming a reused password, a laptop handed back to IT, or a tablet left with an ex-flatmate: each one is a reason the password moves, and each used to come with the second chore of hunting down what was still signed in. The chore folded into the change.

The form sits behind [Change password](/account/password?utm_source=blog-password-change-signs-out-every-app&utm_medium=internal&utm_content=change-password) on [the account page](/account?utm_source=blog-password-change-signs-out-every-app&utm_medium=internal&utm_content=account). It asks for the current password first, and the new one closes every other door on its own.
