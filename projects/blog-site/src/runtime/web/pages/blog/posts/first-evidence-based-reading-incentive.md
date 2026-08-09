---
title: "Introducing the First Evidence-Based Reading Incentive for Reading Lists"
description: "The next-read card is a reading incentive built on behavioral science. Saving an article is an intention, and studies find about half of intentions never become action. So rather than nag you to clear a backlog, Readplace hands you one concrete next read from your own saves, with the reason it fits, right as you finish an article. That single reasoned step is what the research says releases the pull of an unfinished list."
slug: "first-evidence-based-reading-incentive"
date: "2026-08-08"
author: "Fayner Brack"
keywords: "evidence-based reading incentive, intention behavior gap, digital hoarding, reading list psychology, why saved articles go unread, what to read next, read it later suggestions, resurface saved articles, finish your reading backlog, implementation intentions reading"
tags: ["changelog"]
banner: "I put your next read at the end of the one you're finishing"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

At the end of an article, right as the last paragraph scrolls into view, a small card slides into the corner of the reader with one suggestion: a saved article still unread, and a line on why it belongs beside the one just finished. Readplace picks it from your own queue and nowhere else. That single next step is the whole idea, and it rests on a body of research: saving an article is an intention, and roughly half of intentions never turn into action. The fix the evidence points to is not a tidier backlog but one concrete, reasoned next move, handed over at the moment you are free to take it. Each save lines up as many as 1000 unread saves and asks a language model, prompted as a librarian, to pick at most 3 that relate, each with a short reason. The reader shows the first still unread, along with when it was saved. Read one and it leaves the pool. Dismiss the card and it stays dismissed for that article across devices. The picks need raw material: 50 unread saves is the floor, and below it the card stays away.

</div>
</details>

Reach the last paragraph of an article in the Readplace reader and a small card slides into the corner of the page. It carries one suggestion: an article already sitting in your queue, saved weeks or months ago, still unread, with a one-line reason it belongs beside the piece just finished.

The card waits for the end on purpose. It stays hidden while the text has your attention and shows up once the bottom of the article scrolls into view.

The end of an article is the one moment a reader is free to start another. That is the only moment the card takes.

I am calling it a reading incentive because it changes the economics of the next read. Instead of a wall of saved links to sort through, it puts one chosen article in front of you, with the reason it fits, at the one moment you are free to start it. And I am calling it evidence-based because each of those choices, the single pick, the written reason, the timing, traces back to research on why reading lists fill up and never empty. As far as I know it is the first reminding feature in a read-it-later app built that way on purpose, so let me show the work.

## The queue that only took things in

My queue grew the way most reading queues grow. Saving takes one click and reading takes half an hour, so the list tilts toward saving. What went in 2 months ago sits a long scroll under what went in this morning.

Every save is an intention to read, and intentions are cheap. Psychologists call the space between meaning to and doing the [intention-behavior gap](https://doi.org/10.1111/spc3.12265), and when they measure it, roughly half of the people who intend to act never get to it. A reading list is that gap made visible: a stack of good intentions, most of which will not convert on their own.

> **An article you saved 2 months ago is not rejected, just buried.**

The pile is not free to keep, either. A [study of digital hoarding](https://doi.org/10.1016/j.chb.2018.03.031) found the same triad that marks the physical kind, over-accumulation, difficulty deleting, and low-grade anxiety about the heap, forming around the files people save and never open. A reading queue that only grows is not neutral storage. It is a small, standing weight.

Readplace had the reminding half built, behind an experiment flag. For each new save it computed which of a tester's other saves related to it, then showed the results as a list of 3 under the article body, where they competed with the closing paragraphs and offered choices at the moment the reader had decided to stop. This week the flag came off, the list shrank to a single card, and the card reached every reader.

## Why one next step beats a tidier list

The obvious fix for a backlog is to clear it: set aside an afternoon, open the list, and grind it down. The research says that is close to the worst thing to ask of yourself, because clearing a backlog is one more intention, and the bigger the pile the easier that intention is to swallow.

An unfinished intention does not sit quietly. Ever since Bluma Zeigarnik measured it in 1927, we have known that unfinished tasks hold a privileged place in memory and keep tugging at attention. A reading list is dozens of those open loops at once, each a small tax you pay for having meant to read something.

Here is the finding that shaped the card. In a [study on plan making](https://doi.org/10.1037/a0024192), unfulfilled goals produced intrusive thoughts and worse performance on unrelated tasks, exactly as the open-loop idea predicts. But writing down a single, specific plan for the goal made the interference disappear, even though the goal itself stayed unfinished. You do not have to finish the list to quiet it. You have to turn "someday, all of it" into "this one, next."

> **You do not have to empty the list to put it down. You have to choose the next one.**

That is the whole design. The strongest gap-closer anyone has measured is an [if-then plan](https://doi.org/10.1037/0003-066X.54.7.493) that fixes when and where and how you will act: when situation X arrives, I will do Y. The card is that plan, supplied for you at the trigger. When you finish this article, read that saved one, and here is why it belongs beside it. It is the plan you never made at save time, handed to you at the one moment you can act on it.

## A librarian over what you kept

The picking happens at save time. A new link lands in the queue, and a background job lines up as many as 1000 of its unread saves beside it. A [language model](/view/en.wikipedia.org/wiki/Large_language_model), prompted to act as a librarian, reads the pile and picks at most 3 saves that relate to the new arrival, each with a reason of 120 characters or fewer naming what the two share.

The prompt hands the model a ladder and tells it to stop at the first rung that yields something: the same subject or a follow-up first, the same argument from another side next, the same field or craft from a different angle last. A pick the model can't name a shared subject for isn't allowed out. An empty answer is fine when the saves share nothing with the new arrival.

What I care about most is where the pool ends. It's your saves and nothing else. A trending story or a partner link can't appear on the card, because neither exists in the inventory it picks from.

> **The card can only offer you something you already decided was worth your time.**

## Unread, then gone

Every suggestion is something you haven't read yet. Read one and it drops out of the pool. The list behind the card shrinks as you work through it, and the card stops appearing on an article once nothing unread relates to it.

Mark an old save unread and it's suggestible again. None of this costs an AI call, since reading, unreading, and deleting filter a list that was already computed at save time.

Dismissal is a real answer too. The X on the card stamps the dismissal on your account rather than in your browser, so a suggestion you waved away on the laptop won't chase you onto the phone.

Fresh saves needed one more piece. Save a link and open it straight away, and the suggestions are often still being computed while you read.

One fresh save, measured in production on 4 August 2026, got its relations written 97 seconds in. The old slot rendered once and stopped looking, so a reader in that window saw no card for the whole page view. The slot now asks again every 3 seconds until the computation settles, then goes quiet.

## Leaving one article to start another

Clicking the card means leaving the article under it, and the article you leave is the one the queue tends to get wrong. You read it to the last line, and it still counts as unread.

So the reader asks on the way out. Follow the card, or any link in the article body, and a small dialog names the article and asks: did you read it? "Yes, Mark as Read" files it, and "No, Continue and Keep Unread" moves you on and leaves it waiting.

Closing the dialog is the third answer. It cancels the exit and keeps you where you are.

An article marked at the moment you finish it is what keeps the pool clean. The unread filter is only as good as the read marks behind it, and the best time to collect one is the click where you leave.

## The floor is 50 saves

The librarian needs raw material, and the floor is 50 unread saves. Below that the job declines to guess, and the card stays away rather than arriving padded with weak matches. The floor used to be 100, and halving it is what lets a months-old queue qualify instead of a years-old one.

TBH, the librarian is a librarian, not a mind reader. The reason line names what the suggestion shares with the article just finished, not what you're in the mood for tonight. It sits on the card so you can judge the match in a glance, and the dismiss button sits beside it so a wrong guess costs one click.

## What "evidence-based" actually claims

The evidence above is about the mechanism, not a trial of this exact card. It tells me why saved articles go unread, and why a single reasoned next step is a better answer than a guilt trip toward a tidy list. It does not promise a number. I have not run a controlled study on the card itself, and I am wary of the wider literature on just-in-time reminders, which cuts both ways.

So when I call it the first evidence-based reading incentive, I mean something narrow and checkable. The feature was designed backward from the research on why reading lists fail: the single pick comes from plan making, the timing from the open loop that a finished article closes, the written reason from an if-then plan that names the trigger and the action. If another read-it-later app has tied its reminding feature to that literature on purpose, I have not found it.

## Past the last paragraph

The card only exists past the last paragraph, so the way to meet it is to finish something. Open the save that has waited longest in [your queue](/queue) and read it through. Past the ending is the next one you already chose.

A queue still short of the 50-save floor fills fastest with [the browser extension](https://readplace.com/install), and the finishing happens at [readplace.com](/).

An app that remembers your reading list is an archive. One that hands the right save back at the right moment is how the list gets read.

## Further reading

- Sheeran, P., & Webb, T. L. (2016). [The Intention–Behavior Gap](https://doi.org/10.1111/spc3.12265). *Social and Personality Psychology Compass*, 10(9), 503–518. ([open PDF](https://eprints.whiterose.ac.uk/id/eprint/107519/3/The%20Intention-Behavior%20Gap%20R1.pdf))
- Sweeten, G., Sillence, E., & Neave, N. (2018). [Digital hoarding behaviours: Underlying motivations and potential negative consequences](https://doi.org/10.1016/j.chb.2018.03.031). *Computers in Human Behavior*, 85, 54–60.
- Masicampo, E. J., & Baumeister, R. F. (2011). [Consider it done! Plan making can eliminate the cognitive effects of unfulfilled goals](https://doi.org/10.1037/a0024192). *Journal of Personality and Social Psychology*, 101(4), 667–683. ([open PDF](https://users.wfu.edu/masicaej/MasicampoBaumeister2011JPSP.pdf))
- Gollwitzer, P. M. (1999). [Implementation intentions: Strong effects of simple plans](https://doi.org/10.1037/0003-066X.54.7.493). *American Psychologist*, 54(7), 493–503.
- Zeigarnik, B. (1927). Über das Behalten von erledigten und unerledigten Handlungen. *Psychologische Forschung*, 9, 1–85. The original study of unfinished tasks in memory. See Masicampo & Baumeister (2011) above for a modern review.
