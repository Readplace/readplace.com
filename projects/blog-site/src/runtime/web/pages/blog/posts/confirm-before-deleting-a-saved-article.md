---
title: "The One Button You Couldn't Take Back"
description: "Deleting a saved article in Readplace used to be one click with no undo. It asks for confirmation now, built on the browser's native HTML popover with no JavaScript, no extra route, and no change to the delete API the apps and extensions already use."
slug: "confirm-before-deleting-a-saved-article"
date: "2026-07-27"
author: "Fayner Brack"
keywords: "read it later delete confirmation, confirm before deleting saved article, undo delete read it later, accidental delete read later app, html popover confirmation dialog, native popover no javascript, delete confirmation without javascript, read it later app data safety, save reading queue protect deletes, are you sure delete web app"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Every other action in the queue could be walked back. Mark an article read and an undo toast waited a few seconds to reverse it. Delete could not: one click on a small icon and the saved copy was gone, on every row of both tabs, with nothing offering it back. Readplace now puts a confirmation in front of that click. The delete button opens a panel that asks before anything is removed, and the panel is the browser's native popover, so pressing Esc, clicking outside it, and the backdrop element behind it are the platform's own behaviour rather than code I wrote — only the dim on that backdrop is mine, a couple of lines of CSS. There is no client bundle, no extra route, and no query parameter carrying the state. A submit button cannot open a popover, so the confirmed delete ships as its own trigger, and the plain one-click form stays as the fallback for a browser too old to support popover. The route that actually removes an article did not change, so the extensions, the iPhone app, and every other client that deletes are untouched. Only the website added a question in front of the one action you could not take back.

</div>
</details>

One click on a 44-pixel icon, and a saved article was gone. There was no confirmation and no undo behind it. The button sat on every card in the queue, on the tab of things to read and the tab of things already read, and it did the same thing on all of them.

Every other action on a card could be walked back. Marking an article read is reversible, and it still drops an undo toast that reverses it for a few seconds after you tap. Delete was the exception. It was the only control on the card with no way back and no pause before it happened.

The action you can't reverse is the one that should ask first. Written down it sounds obvious. The queue had it the other way around: the reversible action carried the undo toast, and the permanent one went through on a single tap.

> **The action you can't reverse is the one that should ask first.**

## The one action with no way back

So delete asks now. Click it and a panel opens over the card. It names what is about to happen and gives you two answers, cancel or delete, and nothing leaves the queue until you pick delete. The click that used to be the whole action is now the click that opens the question.

Nothing else changed about the button. It's the same icon in the same spot, still one tap to reach. The tap lands you at a decision instead of at a deletion.

## A confirmation the browser draws itself

The confirmation is a [native HTML popover](/view/developer.mozilla.org/en-US/docs/Web/API/Popover_API). The delete button points at the panel by id, the browser opens it, and the parts that make a dialog behave like a dialog come with it. Esc closes it. A click outside it closes it. The browser stacks it over a backdrop element in the top layer. None of that behaviour is code I keep working. The one part I do write is the dim: a popover's backdrop is transparent until you colour it, so the shade over the rest of the page is a couple of lines of my CSS, one for light and one for dark.

> **The popover attribute hands the dialog's behaviour to the browser — the Esc key, the click-outside, the backdrop it stacks over — and leaves me a couple of lines of CSS to colour the dim.**

That saves more than it looks like it does. A confirmation dialog is the kind of small thing people reach for a library to build, and the library brings a bundle to download, focus handling to get right, and a scrim to style and to trap clicks. The popover attribute hands nearly all of it to the browser: the bundle is gone, the focus and the click-trapping come built in, and the only piece left in my hands is the scrim's colour. There is no client script for the panel, no route it posts to on the way open, and no query parameter tracking whether it's showing. The whole thing is an attribute on a button and a panel it names.

## A submit button can't ask first

Getting there took one detour worth naming. A button that submits a form cannot also open a popover. The browser runs the submit and returns before it reaches the popover step, so a delete button wired to do both would delete on the first click and the confirmation would never appear. The trigger that opens the panel is a plain button that submits nothing, and the real delete is a form inside the panel.

The old one-click form is still in the page, kept as the fallback for a browser that doesn't understand popover. A reader on one of those gets the original behaviour, a direct delete, rather than a button that opens nothing.

The panels don't live inside the cards either. A card that's still being crawled replaces its own contents every 3 seconds while the clean copy renders, and a confirmation drawn inside it would be torn out mid-decision on the next refresh. So the panels render once at the page level, built from the same list of articles as the cards, which keeps a panel and its button from ever disagreeing about which article they belong to.

## The question before the last click

The route that removes an article never changed. A POST to the delete endpoint deletes exactly as it did before, so the iPhone app, the browser extensions, and every client that deletes through the API behave the same. The website added a question in front of the click, and nothing underneath it moved.

Deleting a saved article is permanent, and Readplace already treats the things you saved as worth keeping around, down to leaving a cancelled account [read-only instead of dark](/blog/why-i-built-readplace). A confirmation before delete is that same instinct one click smaller. Open your queue at [readplace.com/queue](/queue), hover the delete on something you don't need, and watch it ask before it acts. If you don't have a queue yet, it starts at [readplace.com](/).

A one-click delete is quicker. A delete that asks first is the one you never have to wish you could take back.
