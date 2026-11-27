---
title: "The One Button You Couldn't Take Back"
description: "Deleting a saved article in Readplace used to be one click with no undo. It asks for confirmation now, built on the browser's native HTML popover with no JavaScript, no extra route, and no change to the delete API the apps and extensions already use."
excerpt: "Marking read came with an undo, while delete took one click and offered no way back."
tldr: "Every other action in the readlist could be walked back. Mark an article read and an undo toast waited a few seconds to reverse it. Delete could not: one tap and the saved copy was gone, on every row of both tabs, with nothing offering it back. Readplace now puts a confirmation in front of that click. The delete button opens a panel that asks before anything is removed, and the panel is the browser's native popover, so pressing Esc, clicking outside it, and the backdrop element behind it are the platform's own behaviour rather than code I wrote. Only the dim on that backdrop is mine, a couple of lines of CSS. There is no client bundle, no extra route, and no query parameter carrying the state. A submit button cannot open a popover, so the confirmed delete ships as its own trigger. A browser too old to support popover used to get the plain one-click delete. Now it gets the same question on the page itself, reached by a link to it and shown with CSS alone. The panel opens on Cancel, names the article, and warns that removing your last saved copy can take its highlights and notes with it. The route that actually removes an article did not change, so the extensions, the iPhone app, and every other client that deletes are untouched. Only the website added a question in front of the one action you could not take back."
slug: "confirm-before-deleting-a-saved-article"
date: "2026-07-27"
lastModified: "2026-11-26"
author: "Fayner Brack"
keywords: "read it later delete confirmation, confirm before deleting saved article, undo delete read it later, accidental delete read later app, html popover confirmation dialog, native popover no javascript, delete confirmation without javascript, read it later app data safety, save readlist protect deletes, are you sure delete web app"
---

One click on a 44-pixel icon, and a saved article was gone. There was no confirmation and no undo behind it. The button sat on every card in the readlist, on the tab of things to read and the tab of things already read, and it did the same thing on all of them.

Every other action on a card could be walked back. Marking an article read is reversible, and it still drops an undo toast that reverses it for a few seconds after you tap. Delete was the exception. It was the only control on the card with no way back and no pause before it happened.

The action you can't reverse is the one that should ask first. Written down it sounds obvious. The readlist had it the other way around: the reversible action carried the undo toast, and the permanent one went through on a single tap.

> **The action you can't reverse is the one that should ask first.**

## The one action with no way back

So delete asks now. Click it and a panel opens over the card. It names the article, says what is about to happen, and nothing leaves the readlist until you pick a delete button. Cancel is there too, and it is where the panel opens. Press Enter on Delete in the menu, press Enter again by reflex, and the article stays where it was. The click that used to be the whole action is now the click that opens the question.

Delete now sits in the card's own menu, one tap to open and one to choose it. The tap lands you at a decision instead of at a deletion.

The panel is also plain about what a delete costs. Removing an article from one readlist leaves it in any other readlist that holds it. Removing your last saved copy can permanently delete the highlights and notes you made on it, and saving the article again won't bring them back. So the panel says that in one sentence. A second delete button, Delete and skip future confirmations, stops the question for good, and the line under it says where: on every card and in the reader.

## A confirmation the browser draws itself

The confirmation is a [native HTML popover](/view/developer.mozilla.org/en-US/docs/Web/API/Popover_API?utm_source=blog-confirm-before-deleting-a-saved-article&utm_medium=internal&utm_content=read-developer-mozilla-org). The delete button points at the panel by id, the browser opens it, and the parts that make a dialog behave like a dialog come with it. Esc closes it. A click outside it closes it. The browser stacks it over a backdrop element in the top layer. None of that behaviour is code I keep working. The one part I do write is the dim: a popover's backdrop is transparent until you colour it, so the shade over the rest of the page is a couple of lines of my CSS, one for light and one for dark.

> **The popover attribute hands the dialog's behaviour to the browser: the Esc key, the click-outside, the backdrop it stacks over. It leaves me a couple of lines of CSS to colour the dim.**

That saves more than it looks like it does. A confirmation dialog is the kind of small thing people reach for a library to build, and the library brings a bundle to download, focus handling to get right, and a scrim to style and to trap clicks. The popover attribute hands nearly all of it to the browser: the bundle is gone, the focus and the click-trapping come built in, and the only piece left in my hands is the scrim's colour. There is no client script for the panel, no route it posts to on the way open, and no query parameter tracking whether it's showing. The whole thing is an attribute on a button and a panel it names.

## A submit button can't ask first

Getting there took one detour worth naming. A button that submits a form cannot also open a popover. The browser runs the submit and returns before it reaches the popover step, so a delete button wired to do both would delete on the first click and the confirmation would never appear. The trigger that opens the panel is a plain button that submits nothing, and the real delete is a form inside the panel.

A browser that doesn't understand popover still needs an answer. Until November 2026 it got the original one-click form, a direct delete, which meant the readers on the oldest browsers were the only ones with no question at all. Now the menu item on those browsers is a link to the same question, rendered further down the same page and hidden until the address points at it. CSS shows it while it is the link's target, so nothing runs to open it. Its Cancel is another link, back to the menu you came from, and its two delete buttons post to the same route as the panel's. Opening the question and cancelling it never touch the server.

The panels and those in-page questions don't live inside the cards either. A card that's still being crawled replaces its own contents every 3 seconds while the clean copy renders, and a confirmation drawn inside it would be torn out mid-decision on the next refresh. So the panels render once at the page level, built from the same list of articles as the cards, which keeps a panel and its button from ever disagreeing about which article they belong to.

## The question before the last click

The route that removes an article never changed. A POST to the delete endpoint deletes exactly as it did before, so the iPhone app, the browser extensions, and every client that deletes through the API behave the same. The website added a question in front of the click, and nothing underneath it moved.

Deleting a saved article is permanent, and Readplace already treats the things you saved as worth keeping around, down to moving a cancelled account [to the free plan instead of going dark](/blog/why-readplace-exists?utm_source=blog-confirm-before-deleting-a-saved-article&utm_medium=internal&utm_content=post-why-readplace-exists). A confirmation before delete is that same instinct one click smaller. Open your readlist at [readplace.com/queue](/queue?utm_source=blog-confirm-before-deleting-a-saved-article&utm_medium=internal&utm_content=queue), open the menu on something you don't need, choose Delete, and watch it ask before it acts. If you don't have a readlist yet, it starts at [readplace.com](/?utm_source=blog-confirm-before-deleting-a-saved-article&utm_medium=internal&utm_content=home).

A one-click delete is quicker. A delete that asks first is the one you never have to wish you could take back.
