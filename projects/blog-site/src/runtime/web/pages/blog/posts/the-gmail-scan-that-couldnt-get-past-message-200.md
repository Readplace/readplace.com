---
title: "The Gmail Scan That Couldn't Get Past Message 200"
description: "Connect Gmail and Readplace pages through the mailbox to find the senders worth turning into newsletter inboxes. In production that scan froze near message 200 of any real mailbox, with a clean log behind it. The thing stopping it was an AWS safety feature doing its job on a loop I had built on purpose."
slug: "the-gmail-scan-that-couldnt-get-past-message-200"
date: "2026-09-13"
author: "Fayner Brack"
keywords: "aws lambda recursive loop detection, lambda recursion detection sqs, lambda stops after 16 invocations, putfunctionrecursionconfig allow, sqs lambda self loop, lambda function invokes itself, serverless pagination pattern, gmail api mailbox scan, dead letter queue recursion, readplace"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

16 invocations is roughly how many AWS Lambda gives a function it suspects of calling itself. The worker Readplace starts when a Gmail account is connected, the one that reads the mailbox to find newsletter senders, is built as exactly that kind of loop, so on 12 September the scan froze near message 200 of any real mailbox without a single failed request in its logs. The loop is deliberate and bounded by Gmail's own page token, and the fix tells AWS exactly that: recursion detection on this 1 function is set to Allow, and a mailbox of any size now reads to the end.

</div>
</details>

On the night of 12 September, AWS decided a function of mine had gone into an infinite loop and stopped delivering its messages. The function was 8 pages into reading a Gmail mailbox, and the loop was the design.

## The scan behind the sender list

Readplace saves the article links out of newsletters. The front door is [an address you hand each newsletter](/blog/save-newsletter-links-to-your-readlist?utm_source=blog-the-gmail-scan-that-couldnt-get-past-message-200&utm_medium=internal&utm_content=post-save-newsletter-links-to-your-readlist), but the newsletters you already get live in Gmail, so there is also [a Gmail connection](/integrations/gmail?utm_source=blog-the-gmail-scan-that-couldnt-get-past-message-200&utm_medium=internal&utm_content=integrations-gmail). Connect the account and a scan walks the mailbox to find who actually sends you mail. The senders it finds fill a picker, and picking one points that newsletter at your readlist.

A mailbox is big and the Gmail API hands it out 25 messages at a time. So the scan is a loop: read a page, store the senders on it, come back for the next.

## A function that queues work for itself

The loop runs on 1 Lambda function and 1 SQS queue. A page command arrives on the queue, the function reads 25 message headers from Gmail, saves what it found, and publishes a progress event. The progress event routes back to the same queue, and that branch of the handler drops the next page command onto the queue with a 10-second delay. The function is its own producer.

I picked that shape over the obvious alternative, a single invocation that loops until the mailbox ends, because a mailbox can hold 20 years of mail and a Lambda invocation is capped in minutes. Paged through the queue, each hop is small, a crash costs 1 page, and a run resumes where it stopped.

The loop also knows how to stop. Gmail's page token runs out when the mailbox does. A generation id fences each page claim, so a stale or duplicated command finds the run has moved on and does nothing. And a command that keeps dying lands in a dead-letter queue, where a consumer marks the run failed so a person can restart it.

## The counter riding in the metadata

What I had not read closely enough is that AWS watches for exactly this shape. [Lambda's recursive loop detection](/view/docs.aws.amazon.com/lambda/latest/dg/invocation-recursion.html?utm_source=blog-the-gmail-scan-that-couldnt-get-past-message-200&utm_medium=internal&utm_content=read-docs-aws-amazon-com) exists because a self-feeding loop is usually a bug, and a bug of the expensive kind: a function that re-queues its own input scales until it has eaten the account's concurrency and a surprising amount of money. When a service like SQS carries a message that a function wrote, the AWS SDK stamps tracing metadata onto it, and part of that metadata counts how many times this chain of requests has invoked the same function. At roughly 16, Lambda stops delivering.

A page of my loop costs 2 invocations, 1 for the page command and 1 for the progress event that schedules the next. 16 invocations is roughly 8 pages, and 8 pages of 25 messages is 200. Any mailbox past its first 200 messages froze mid-scan, and a mailbox worth scanning is past 200.

## Nothing failed, which was the problem

A dropped invocation writes nothing. Lambda refuses the message before the function starts, so the function's log ends on a page that succeeded. From inside the system, page 8 went perfectly and page 9 was simply not asked for.

> **The log ends on a success, because the drop happens before the code gets to run.**

The refused message does not vanish. SQS retries it, Lambda keeps refusing it, and once the queue's redrive policy gives up, the message lands in the dead-letter queue, where the consumer wrote the reader-facing status: Gmail sender loading paused. Try again to continue. Trying again started a fresh chain with a fresh counter, so each press bought about another 200 messages. A 10,000-message mailbox sat 50 presses from done.

AWS does say what it did, in its own places. There is a RecursiveInvocationsDropped metric, an entry on the account's health dashboard up to 3.5 hours later, and at most 1 email per function per day. What none of those places hold is the stalled progress count a reader was watching.

## The fix is a permission

Lambda's detection can be switched off for a single function, so the discovery worker is now provisioned with its recursion setting on Allow, and the whole change is 1 Pulumi resource. Every other function in the account keeps the default, because for every other function the default is right.

The tempting fix was the other one: restructure the continuation so the chain looks less like a loop, an extra queue here, a fan-out there, until the counter stops matching. That hides the loop from a detector the rest of the fleet still needs, and it buys the next stall a better disguise. The loop already had its own ways to stop, the page token, the generation fence, the dead-letter consumer, and Allow is how you tell AWS the stopping is handled.

## Mailboxes bigger than 200 messages

The scan now reads to the end of whatever it is pointed at, 25 headers a page, 10 seconds apart, until Gmail has no next page to hand back. A deep mailbox takes a while. It gets there.

The loop runs the way it ran on 11 September, and AWS now takes my word for what it is.

Newsletters that already arrive in your Gmail are the ones this unblocks: [connect the mailbox](/integrations/gmail?utm_source=blog-the-gmail-scan-that-couldnt-get-past-message-200&utm_medium=internal&utm_content=integrations-gmail) and pick the senders worth keeping, or skip the inbox and give a newsletter [an address of its own](/blog/save-newsletter-links-to-your-readlist?utm_source=blog-the-gmail-scan-that-couldnt-get-past-message-200&utm_medium=internal&utm_content=post-save-newsletter-links-to-your-readlist). The links end up at [readplace.com](/?utm_source=blog-the-gmail-scan-that-couldnt-get-past-message-200&utm_medium=internal&utm_content=home) either way, which is where the reading was supposed to happen.
