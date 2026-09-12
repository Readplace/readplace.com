---
title: "Find every newsletter buried in your Gmail"
description: "Connecting Gmail now gets you a picker built from your own mailbox: Readplace scans it, lists who emails you, and turns any sender you choose into a forwarding filter, so that newsletter's article links land in your readlist. The scan behind the picker used to freeze about 200 emails in, because AWS Lambda mistook its paging for an infinite loop. This is the story of being allowed to finish."
slug: "find-every-newsletter-buried-in-your-gmail"
date: "2026-09-13"
author: "Fayner Brack"
keywords: "gmail newsletter import, find newsletter senders in gmail, forward gmail newsletters to read it later, gmail forwarding filter newsletters, newsletter inbox, aws lambda recursive loop detection, readplace"
tags: ["changelog"]
banner: "I taught Readplace to find every newsletter in your Gmail"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Inside the Gmail integration, a Load senders button now builds a sender picker from the mailbox itself. Connect Gmail, press it, and Readplace pages through the account and lists who emails you, so forwarding a newsletter to your readlist starts from a searchable list instead of memory. The scan behind that button used to freeze about 200 emails in. AWS Lambda took its paging pattern for an infinite loop and cut the chain at 16 hops, so I proved the loop ends and set the function's recursion policy to Allow. A deep mailbox now scans to the bottom.

</div>
</details>

On September 12, in production, the Gmail mailbox scan hit a ceiling that appears in none of Readplace's code. Any scan that needed a 9th page of messages froze on its 8th. The counter under the button stopped somewhere around 200 messages and sat there, and the logs showed clean pages followed by nothing.

## The picker the scan feeds

The scan exists because the Gmail integration asks a question: which senders should forward to a readlist? The answer used to be whatever names came to mind, and a decade of mail holds more senders than a memory does. So the integration reads the mailbox and turns the answer into a list. Connect Gmail under Integrations, press Load senders, and Readplace collects who emails you, searchable by name or address.

Choose a sender from that list and Readplace writes a forwarding filter into Gmail through Gmail's own API. From then on, email from that sender forwards to your private Readplace address, and the article links inside land in the readlist, crawled and summarized like any other save.

## A worker that queues its own next page

Reading a mailbox isn't one call. Gmail hands messages out in pages, the worker takes 25 at a time, and it schedules each next page 10 seconds out, so the scan is a background hum rather than a burst.

The scheduling is where this story turns. When the worker finishes a page it publishes a progress event, the event routes back to the worker's own queue, and the worker, meeting its own event, queues the command for the page after. The function feeds itself until Gmail stops handing back a page token.

## The loop AWS was watching for

AWS watches for exactly that shape. Lambda's [recursive loop detection](/view/docs.aws.amazon.com/lambda/latest/dg/invocation-recursion.html?utm_source=blog-find-every-newsletter-buried-in-your-gmail&utm_medium=internal&utm_content=read-docs-aws-amazon-com) follows a chain of invocations through queues and event buses, and when the same function turns up about 16 times in one chain, it drops the next message instead of delivering it. The feature exists for the developer who wires a function's output back to its input by mistake and would otherwise find out from the invoice. It's on by default, and it doesn't ask first.

> **To the loop detector, a mailbox scan and a runaway bill look the same for the first 16 hops.**

16 invocations came out to 8 pages of the scan. 8 pages of 25 messages is 200 emails, and a mailbox that small barely exists. The message for page 9 wasn't failing anywhere I could see, which was the confusing part. It just wasn't delivered at all.

## Proving the loop ends

The fix AWS offers is a function-level setting that declares the recursion intentional. It's 1 line of infrastructure, and it's the kind of line that deserves suspicion before it ships, because the detector is right about the shape. This is a function invoking itself through its own queue, open-endedly. The question that has to have an answer is what stops it.

3 answers were already in the design. Gmail's page token runs out when the mailbox does, and with no token there is nothing left to queue. A generation fence sits on every page claim, so a scan that was restarted or superseded can't keep the old chain alive, the stale page fails its claim and the chain ends there. And a page that dies through all its retries lands with a dead-letter consumer that writes the whole run down as failed, so no scan waits on a page that won't come.

With those 3 on the record, the function now carries the setting: recursion allowed, on this one worker, because on this one worker the loop is the design.

## The counter runs out of mailbox now

Since the fix, the only thing that stops a scan is the mailbox ending. The counter under Load senders climbs past 200 and keeps climbing, a scan that fails partway resumes with its progress and its estimate intact, and the finished list reaches senders who last wrote years ago.

If your newsletters live in Gmail, point [the Gmail integration](/integrations/gmail?utm_source=blog-find-every-newsletter-buried-in-your-gmail&utm_medium=internal&utm_content=integrations-gmail) at them and let the counter run out. The links they carry will land in [your readlist](/?utm_source=blog-find-every-newsletter-buried-in-your-gmail&utm_medium=internal&utm_content=home) from the next email on.

The fix was 1 line because the expensive part was already done. The proof that the loop ends was in the design before AWS asked the question, and the setting does nothing but sign my name under it.
