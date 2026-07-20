---
title: "Every 3 Seconds, the Cursor Jumped to the Top"
description: "A pending card in the newsletter inbox refreshed itself every 3 seconds and dropped a keyboard user's focus each time. Readplace gives the card and its buttons stable ids drawn from the link's position in the email, so htmx sets the cursor back on the same button after every refresh."
slug: "keyboard-focus-survives-a-live-refresh"
date: "2026-07-21"
author: "Fayner Brack"
keywords: "keyboard focus lost on refresh, htmx focus after swap, keep focus during polling, accessible live updating list, wcag 2.4.3 focus order, keyboard navigation reading queue, focus jumps to top on refresh, htmx restore focus id, keyboard accessible read it later, focus lost every few seconds"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

A newsletter inbox fills with cards, one per link a newsletter sent, and a card whose article is still being fetched refreshes itself every 3 seconds until the crawl finishes, for as long as 15 minutes. Each refresh replaced the whole card, its Save button included, so a keyboard user resting on that button lost focus every 3 seconds, for the length of every crawl. The refresh runs on htmx, which restores focus after a swap only to an element carrying a stable id, and neither the card nor its buttons had one, so focus fell to the page body on every tick. WCAG SC 2.4.3. The smaller fix, freezing the buttons out of the refresh, was wrong: a button's accessible name is built from the resolved URL a finished crawl fills in, so a frozen button would keep reading its pending placeholder to a screen reader. The fix gives the card and each button an id drawn from the link's fixed position in the email, so the id reads the same before the crawl and after it, and htmx matches the rebuilt button to the one that had focus and sets the cursor back on it. Verified against the running app: with the ids, 2 swaps leave focus on the Save button, and with them removed, 3 swaps drop it to the body. Each card's id comes from its own position, so a refresh can't move focus onto a neighbouring card.

</div>
</details>

A pending card in the newsletter inbox rebuilds itself every 3 seconds, and it keeps that up for as long as 15 minutes while the article behind it crawls. Each rebuild replaced the whole card, its 2 buttons included, and left the keyboard cursor with nowhere to sit but the top of the page.

Anyone working the inbox by keyboard lost their place on that clock. A cursor resting on a card's Save button was on the page body 3 seconds later, and again 3 seconds after that.

The cards live in [the newsletter inbox](/blog/save-newsletter-links-to-your-queue), where the links a newsletter sent wait to be saved to your queue. A card whose article is still being fetched shows a pending state and polls for a fresher copy until the crawl lands.

That poll is what rebuilds the card, and the rebuild is what threw the focus.

## Why the cursor kept falling to the top

The refresh runs on [htmx](/view/htmx.org/attributes/hx-swap/). The card carries an hx-get and an every-3s trigger, so each fire fetches a new copy of the card and swaps it in for the old one, the whole `<article>` at once.

htmx has a rule for this. It restores focus after a swap, but only to an element that carries an id. In its own words, it "preserves focus between requests for inputs that have a defined id attribute." The button that held focus before the swap and the button after it need the same id, or htmx can't tell they are the same button.

Neither the card nor its buttons carried one. The `<article>` had no id and the Save button had no id, so after each swap htmx had nothing to match the old focus against. Focus fell to `<body>`, which is where a browser puts it when the element that held it is gone.

> **htmx puts the cursor back after a refresh, but only onto an element whose id it knows. Nothing on the card carried one.**

## The tab strip solved this first

The same page had already met this problem one component up. Above the cards sits a strip of tabs, and the poll that refreshes the cards holds back its out-of-band swap of that strip on purpose, so the tab links are not torn down under a keyboard user crossing them.

The reasoning was right there. The cards didn't inherit it. They were the only refreshed node on the page that held focusable controls, and the one node rebuilt with no id to land focus back on.

## The smaller fix that was wrong

The obvious fix was to stop swapping the buttons at all. Freeze the actions row, let the poll rebuild only what sits above it, and focus doesn't move, because the button isn't replaced. Less code, and it looked right.

It wasn't. The Save button's accessible name is built from the article's resolved URL, and the resolved URL is the thing a finished crawl fills in. A pending card doesn't have it yet. Freeze the actions row and the button keeps the name it was born with, so a screen-reader user would still hear the placeholder long after the real address arrived.

The button has to be rebuilt to stay truthful. Rebuilding it is what breaks focus. So the swap had to stay, and focus was the thing to fix.

## Ids that survive the swap

The fix gives the card and each button an id, and the id has to hold steady across the swap or it fixes nothing. So it comes from the card's ordinal, the link's fixed position in the email, which a pending card and that same card once crawled both share.

The `<article>` becomes inbox-card-0000. Its buttons become inbox-card-0000-save and inbox-card-0000-feedback-exclude. The card goes from pending to crawled and the ids stay where they were.

Now htmx matches the rebuilt Save button to the one that had focus and hands the cursor straight back. Each card draws its id from its own ordinal, so a swap on one card can't drop focus onto a neighbour, which would be its own kind of wrong.

None of this was taken on trust. Against the running app, 2 live swaps of inbox-card-0001 left focus sitting on the Save button, and with the ids stripped back out at runtime, 3 swaps dropped it to `<body>` again. A test now serves the same card pending and then crawled and asserts the ids come back identical, so a rename that breaks the match fails the build before it reaches a reader.

> **The id comes from the card's fixed place in the email, so it reads the same before the crawl and after it. That sameness is what carries the cursor back.**

## Keyboard through your newsletter inbox

Hand a newsletter its own address and its articles arrive in the inbox as cards, each one polling itself until its crawl lands. Move onto a card's Save button while it is still filling in, and the cursor stays on that button through every refresh instead of snapping to the top.

Set up the first address from [readplace.com](/), or add [the browser extension](https://readplace.com/install) and save a page by keyboard to feel the focus hold. The card can rebuild itself as many times as the crawl needs, and the cursor waits where you left it.
