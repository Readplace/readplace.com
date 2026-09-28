---
title: "The extension no longer signs itself out"
description: "When 2 requests from the browser extension were refused at the same moment, both spent a refresh token, the second spend was turned away, and the extension signed itself out: about once a day across the installs in production. A refused request now says which token it was holding, so the extension replays the newer one instead of spending a rotation that was already done."
slug: "the-extension-no-longer-signs-itself-out"
date: "2026-09-23"
author: "Fayner Brack"
keywords: "browser extension signed out, extension logs me out randomly, refresh token rotation race, single-use refresh token, chrome extension sign in again, read it later extension, readplace"
tags: ["changelog"]
banner: "Opening 2 tabs no longer signs the extension out"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

2 requests refused in the same instant used to race each other to renew the browser extension's sign-in, and the loser ended the session. Readplace now has the extension check which token a refusal was about before renewing, so a sign-in another request already renewed gets reused instead of spent twice. A second fix stops the extension's web sign-in from piling up a fresh session on every call.

</div>
</details>

18 double rotations in 8 days. That was the count in the browser extension's credential history, and each one was a sign-in spent twice by the same install, the 2 spends landing as close as 0.15 seconds apart.

Behind them sat about 1 automatic sign-out a day across roughly 12 installs. Nobody pressed Sign out. The extension did it on its own, and the next save asked for a password.

## 2 refusals, 1 token

The extension's refresh tokens are single-use. Spending one returns a fresh pair, and the server retires the old pair in the same step.

That design is sound until 2 requests are refused together, which is what an expired access token and 2 open tabs produce. Each request went to refresh. The first rotation succeeded. The second replayed a refresh token the first had just consumed, and the server turned it away.

The extension read that refusal as the end of the session and signed out. On the way out it revoked the newest refresh token, the one the server still accepted, so there was nothing left to recover.

A signed-out extension is a save button that stops working. The reader in front of it had done nothing but have 2 tabs open when a token expired.

## A refusal now names its token

The refresh call now carries the access token the refused request was holding. When storage already holds a different one, another request got there first. The extension replays the newer token and spends no rotation at all.

The check runs twice, once before the exchange and once inside it, because a request can read storage just before a sibling finishes rotating. Only a refusal of the token that is still current spends a refresh token.

## 17 sessions in a morning

A second leak sat next to the first. When the extension opens a web session for the reader, it calls an endpoint on readplace.com, and that endpoint minted a new session on every call without reading the cookie it was sent. 1 reader collected 17 session rows in a single morning.

While web sessions lasted 7 days those orphans expired on their own. [Web sessions now last 180 days, reset by any visit](/blog/still-signed-in-after-a-month-away?utm_source=blog-the-extension-no-longer-signs-itself-out&utm_medium=internal&utm_content=post-still-signed-in-after-a-month-away), and at that length each orphan would have lived 26 times longer. The endpoint now renews the session it was handed when it belongs to the same account, and mints a new one only when there is nothing to renew.

## Where a sign-out still comes from

Pressing Sign out ends the session on the spot. So do a password reset and an account deletion, and a renewal racing any of them loses. 180 days with no visit at all ends it too.

2 tabs and an expired access token are no longer on that list.

## Keep a second tab open

Nothing needs switching on. Update [the browser extension](https://readplace.com/install) if your browser hasn't already, and the next time a token expires with several tabs open, the saves keep landing in [your readlist](/?utm_source=blog-the-extension-no-longer-signs-itself-out&utm_medium=internal&utm_content=home) without a sign-in form in between.
