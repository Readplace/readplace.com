---
title: "Telling 'Not Yet' From 'Not Coming'"
description: "Some pages can't be turned into an article, so their AI TL;DR has nothing to write. Readplace's summary pipeline used to retry that job on a loop, about 170 dead-letter messages a month. It now reads the crawl's verdict first and marks the summary done when no text is coming."
slug: "ai-summary-stops-when-a-page-cant-be-read"
date: "2026-07-15"
author: "Fayner Brack"
keywords: "ai summary stuck, read it later ai summary, why ai summary fails, article that cant be summarized, ai tldr reliability, read it later summary not working, summary pipeline retry loop, dead letter queue summary, ai summary for unreadable page, reliable ai article summary"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Some pages can't be turned into a clean article. A 404, a page that is only an image or a video, a paywall, a page that draws nothing until JavaScript runs. Readplace's crawler marks those as failed or unsupported, and no article text follows. The AI TL;DR still had a job queued for each one, and with no text to read it threw an error, retried, and after enough tries was marked failed. A background stale-check then reprimed every failed summary to heal a model outage, and it could not tell a brief outage from a page that has no text to read, so it retried the same job on a loop, about 170 dead-letter messages a month. The summary step now reads the crawl's verdict before it reaches for content. If the crawl gave up for good and there is no text, it marks the summary skipped, a done state the stale-check leaves alone, so the loop ends. A crawl still running keeps the retry, because its text may yet land, and a ready crawl with missing text still raises the alarm, because that is a real fault. A reader opening one of these pages sees the same note that the page couldn't be read. What changed sits underneath, where a job that used to run in a loop runs once and stops, and the real summary failures are no longer buried under a crowd of impossible ones.

</div>
</details>

About 170 messages a month were landing in a queue for jobs that had given up. Each one asked for the same thing, a summary of an article whose page Readplace could not read. There was no text to hand the model, so the job failed, went back in line, and failed again.

When you save a link, two jobs run behind it. One crawls the page, fetches it and cleans it into the reader copy you keep. The other writes the [TL;DR](/blog/how-ai-tldr-actually-works) from that copy. Each keeps its own state, and the summary waits on the crawl to hand it something to read.

Some pages have no article to give. The address is a 404, or the page is a bare image or a video with no words, or a paywall stands where the body should be, or the page draws nothing until JavaScript runs. The crawler calls those failed or unsupported. Both are terminal. The page has been looked at, and no clean copy is coming from it.

The summary job did not read that verdict. It ran anyway, reached for the article text, and found none. An assertion in its path said the text must be there, so a missing body threw an error. The record went back onto the queue, ran again, and after a set number of tries landed in the [dead-letter queue](/view/docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html), where the summary was marked failed.

That failed state is what a second job watches. A stale-check reprimes failed summaries, running the model again up to a budget, so a summary lost to a brief model outage heals on its own. It reads one fact, that the summary failed, and reprimes. It could not tell a model that was down for a minute from a page that holds no text to summarize. So it reprimed a job that had nothing to work with, which failed, which it reprimed again.

> **A retry helps a job that could have worked. It does nothing for one that had no chance.**

## Three things a missing body can mean

When the summary job finds no text, that gap means one of three things, and they do not share an answer.

The crawl might still be running. The text is on its way, and a retry is right, because the next run may find it.

The crawl might say it finished and the text still be gone. That is an inconsistency, a real fault worth an alarm, so the job throws and the retry path stands.

Or the crawl gave up for good. The page failed or was unsupported, and no text will follow. Retrying that is retrying nothing.

The old code folded the third case into the second. A page that could not be read and a page with a genuine fault took the same throw, the same retries, the same dead-letter landing. One of them earned it. The other just looped.

## Reading the verdict first

The fix is a check the summary job runs before it reaches for content. It loads the row, sees the crawl marked failed or unsupported, and marks the summary skipped, with the reason recorded as crawl-failed or crawl-unsupported.

Skipped is a finished state. It sits beside ready as a done outcome, not beside failed as an error. The stale-check leaves skipped rows alone, so the reprime does not fire and the loop closes on the first pass.

The two cases that earned a retry keep it. A crawl still in flight leaves the assertion in place, so a run that arrives early throws and comes back when the text has landed. A crawl marked ready with the body missing throws too, because a summary with nowhere to read from, on a page that should have one, is a fault someone should see.

## The phantom errors that hid the real ones

The skipped-versus-failed line is not a label for its own sake. A failed summary is an error the health checks count and surface. A skipped one is a clean outcome they pass over. About 170 phantom errors a month were sitting in the same pile as the summaries that failed for a reason, the ones a model outage actually broke.

Clear the phantoms and the pile holds only the failures worth reading. A real summary fault stops hiding behind a crowd of jobs that were retrying a page with no text to read.

> **A page that can't be summarized is a finished result, not a broken one.**

## What a save does with an unreadable page

Save a link and the crawl decides what it is. A page it can read gets a TL;DR built from the copy you keep, [rebuilt later if a cleaner copy of the page arrives](/blog/ai-summary-updates-with-the-article). A page it can't read gets a short skipped mark, and the summary step sets it down instead of circling it.

You still see that the page couldn't be read when you open it. The change is underneath, where a job that used to run in a loop now runs once and stops. Give Readplace a page it can read and one it can't, through [the browser extension](https://readplace.com/install) or [readplace.com](/), and watch the summary either land or step aside, with nothing left circling between the two.
