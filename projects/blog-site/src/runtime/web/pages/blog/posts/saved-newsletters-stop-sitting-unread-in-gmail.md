---
title: "Saved Newsletters Stop Sitting Unread in Gmail"
description: "Saving a newsletter to a readlist used to leave its Gmail copy untouched, so the same issue was cleared twice: once in Readplace, once back in the inbox. A checkbox on each sender now has Readplace mark the original read and label it imported-to-readplace once the save has safely landed, and a backfill does the same for the issues saved while the option was off."
excerpt: "A saved newsletter no longer sits unread in Gmail, waiting to be cleared a second time."
tldr: "The Gmail copy of a newsletter Readplace saved used to stay bold and unread, waiting to be cleared by hand. A checkbox on each sender now has Readplace label the original imported-to-readplace and mark it read, once everything the email selected to save has actually been saved. The option is off until ticked, it asks Google for the extra permission only at that moment, and an Apply to earlier emails button reaches the issues saved before it was on."
slug: "saved-newsletters-stop-sitting-unread-in-gmail"
date: "2026-11-01"
author: "Fayner Brack"
keywords: "mark newsletters as read automatically, gmail newsletter label, unread newsletters gmail, newsletter overload, gmail integration read it later, mark email read after saving, imported-to-readplace, inbox zero newsletters, readplace"
tags: ["changelog"]
banner: "A newsletter Readplace saved no longer has to sit unread in Gmail"
---

Gmail's unread count can't tell a newsletter Readplace already saved from mail nobody has answered yet. An issue that landed in a readlist this morning stays bold in the inbox, adding to a count it no longer belongs in.

[Connecting Gmail to Readplace](/blog/introducing-gmail-integration?utm_source=blog-saved-newsletters-stop-sitting-unread-in-gmail&utm_medium=internal&utm_content=post-introducing-gmail-integration) left that copy alone on purpose. The launch post promised it plainly: Readplace "archives nothing there and marks nothing read".

That stays the default. It stopped being the only choice this week.

## One checkbox per sender

Each sender mapped to a readlist now carries a box on its card under [Newsletters](/newsletters?utm_source=blog-saved-newsletters-stop-sitting-unread-in-gmail&utm_medium=internal&utm_content=newsletters): "Mark imported emails as read and label them imported-to-readplace". Ticked, it covers that sender's issues alone. The rest of the mailbox stays out of scope.

The first tick is also where Google's consent screen appears. Connecting Gmail did not ask for the right to change mail, and it still does not, so the permission is requested at the moment it gains a purpose.

Refusing it stores nothing: the box stays unticked and the option stays off. Once the permission is granted, the dialog that maps a new sender offers its own box, pre-ticked.

## Marked only after the save lands

> **The Gmail original changes only once everything the email selected to save is actually saved.**

A mapped email can save the issue itself, the articles it links to, or both. Readplace follows each of those saves and touches Gmail when the last one is safely written. A save that is held, truncated or failed leaves the original exactly as it was.

The change itself is 1 request: the `imported-to-readplace` label goes on, the unread flag comes off. Nothing is archived and nothing moves, so the issue is still in the inbox, under any labels it already had. The label doubles as a record, and a Gmail search for label:imported-to-readplace lists every issue Readplace has taken in.

Summaries and filing keep running after the save, and the mailbox does not wait for them. An issue deleted from Gmail before its save finished is noted and left at that.

## Earlier issues catch up

The checkbox governs the saves made after it is ticked. For the rest, the sender's card offers "Apply to earlier emails".

That backfill walks back through the sender's mail and gives each fully saved issue the same treatment, whether it arrived through the 30-day import or was forwarded as it landed. It acts only on proof that every piece of an email was saved. Readplace began keeping that proof in early October 2026, so issues saved before then are left alone rather than guessed at.

## Off is still the default

A mailbox whose boxes are all unticked behaves exactly as the launch post described: Readplace reads what the mappings ask it to read and changes nothing.

Unticking a box stops the marking at once and cancels its running backfill. What was already labelled stays labelled, and a change already on its way to Gmail still lands. The permission itself stays granted, so ticking the box again later takes effect without another consent screen.

The option ships inside the [Gmail integration](/blog/introducing-gmail-integration?utm_source=blog-saved-newsletters-stop-sitting-unread-in-gmail&utm_medium=internal&utm_content=post-introducing-gmail-integration-paid), which comes with a paid subscription.

## The sender to start with

The box earns the most on the sender whose issues stack up fastest. That sender's stripe of bold rows is mostly reading Readplace already holds, summarized and filed.

Tick its card under [Newsletters](/newsletters?utm_source=blog-saved-newsletters-stop-sitting-unread-in-gmail&utm_medium=internal&utm_content=newsletters-cta), run "Apply to earlier emails", and what remains of the unread count is mail that needs an answer, not reading that already has a home. A mailbox not yet connected starts with a sign-in and 1 pasted address at [readplace.com](/?utm_source=blog-saved-newsletters-stop-sitting-unread-in-gmail&utm_medium=internal&utm_content=home).
