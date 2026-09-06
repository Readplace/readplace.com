---
title: "The Next Read Under Your Article Stopped Guessing"
description: "The card that offers a related save from your own readlist used to invent 1 connection in every 6. After 5 shipped fixes it invents 1 in 32, it hands you unread saves first, and it stays quiet when nothing truly relates. Finishing one article now shortens your pile instead of just ending."
slug: "the-next-read-under-your-article-stopped-guessing"
date: "2026-08-12"
author: "Fayner Brack"
keywords: "what to read next, reduce reading backlog, related articles suggestion, read it later readlist, next read card, pocket alternative, reading pile, ai reading recommendations accuracy, save articles for later"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Under each article you finish in Readplace sits a small card offering one more save from your own readlist, picked because it relates to what you just read, with unread saves taking the slot first. Those picks used to be wrong often enough to ignore: 1 suggestion in 6 had no real connection, and 73% of the explanations opened with the word "Both". I graded 544 of the card's own suggestions across 5 rounds of fixes on a live test account, with every "wrong" verdict forced to survive 3 independent skeptics. Wrong picks fell from 18 in 116 to 3 in 98, the explanations read like sentences a person would write, and a save with no genuine relative now gets silence instead of an invention. Reading one article pulls the next one off your pile.

</div>
</details>

"PostgreSQL 14 release notes expand on partitioning and performance improvements."

Readplace wrote that line under a [research post about poisoning language models](/view/www.anthropic.com/research/small-samples-poison?utm_source=blog-the-next-read-under-your-article-stopped-guessing&utm_medium=internal&utm_content=read-www-anthropic-com). It was the reason a reader should open the Postgres notes next. The 2 pages share nothing, and the sentence does not even pretend they do. It describes the wrong article.

The card that produced it exists to shorten your pile. Finish something, and Readplace offers one related save from your own readlist, unread saves first, because the point of a reading list is to get through it. A past read only takes the slot when nothing unread relates.

A card like that lives or dies on trust.

> **A suggestion that can be wrong teaches you to ignore the corner of the screen it lives in.**

## A quota it always filled

The picker is a small, fast language model (DeepSeek) reading your saves' titles and summaries. Its old instructions told it that "a merely-plausible pick beats an empty answer". It heard a quota. Given 3 slots, it filled 3 slots, and when a save had no genuine relatives in the readlist it invented some. A knitting tool got paired with an espresso machine shop. Google's Espresso networking post got the same shop, on the strength of the name alone.

The explanations had a tell too. 85 of the first 116 opened with the word "Both", and on 24 of the first 40 saves every single explanation did. A reader scanning the card saw the same sentence shape over and over, wrapped around connections that sometimes did not exist.

## 44 saves, graded 5 times over

I filled a test account with 158 real articles in deliberate clusters: Postgres, LLMs, Rust memory, sleep science, browser engines, startups, and a few loners like a woodworking site, so some saves had true relatives waiting and some had none. Then I saved 44 of them through the save bar and graded every suggestion the card produced.

Grading your own feature invites self-delusion. So a pick only counted as wrong after 3 independent skeptics, each told to prove the verdict mistaken by naming a subject the 2 pages share, all failed to do it.

Round 1: 18 of 116 suggestions shared nothing with the article they sat under. About 1 in 6.

The first 3 fixes were wording. Telling the model that an empty answer is correct made things worse, 25 wrong, because it kept filling every slot and just described its picks differently. Rebuilding the instructions so that abstention is the default helped, 14. Showing it 3 good and 3 bad example sentences fixed the writing style but barely moved the picks, 13. The wording had hit its floor.

## 2 bugs the wording never touched

Of the 13 wrong picks left, 9 had explanations that never mentioned the saved article at all. The model reads the article, then a list of up to 150 candidates from your readlist, and by the end of that list it had lost the beginning. No instruction fixes attention. Repeating the saved article at the bottom of the list, right where the model starts writing its answer, did.

The other cluster was stranger. Some sites answer a crawler with an anti-bot wall, and Readplace had stored 2 of those walls as real articles titled "Client Challenge". The picker matched them to each other, and to anything. The fix keys on the one property a block page cannot shed: the same exact text serving 2 different websites is not an article. There is no list of vendor phrases to go stale, and the moment a better crawl replaces the wall with the real page, the rule lets it back in on its own.

Round 5, same 44 saves: 3 wrong in 98. About 1 in 32. And 9 of the 44 saves answered with silence instead of an invented neighbour.

<div style="margin: 18px 0 6px; font-size: 0.85em;">
  <div style="display: grid; grid-template-columns: 12em 1fr 7em; gap: 8px; align-items: center; margin-bottom: 7px;">
    <span style="text-align: right;">1 · original wording</span>
    <span style="background: rgba(127,127,127,0.16); border-radius: 3px; height: 15px; display: block;"><span style="background: #c8702a; height: 15px; width: 72%; display: block; border-radius: 3px;"></span></span>
    <strong style="font-variant-numeric: tabular-nums;">18 / 116</strong>
  </div>
  <div style="display: grid; grid-template-columns: 12em 1fr 7em; gap: 8px; align-items: center; margin-bottom: 7px;">
    <span style="text-align: right;">2 · name the subject</span>
    <span style="background: rgba(127,127,127,0.16); border-radius: 3px; height: 15px; display: block;"><span style="background: #c8702a; height: 15px; width: 100%; display: block; border-radius: 3px;"></span></span>
    <strong style="font-variant-numeric: tabular-nums;">25 / 116</strong>
  </div>
  <div style="display: grid; grid-template-columns: 12em 1fr 7em; gap: 8px; align-items: center; margin-bottom: 7px;">
    <span style="text-align: right;">3 · empty is an answer</span>
    <span style="background: rgba(127,127,127,0.16); border-radius: 3px; height: 15px; display: block;"><span style="background: #c8702a; height: 15px; width: 59%; display: block; border-radius: 3px;"></span></span>
    <strong style="font-variant-numeric: tabular-nums;">14 / 109</strong>
  </div>
  <div style="display: grid; grid-template-columns: 12em 1fr 7em; gap: 8px; align-items: center; margin-bottom: 7px;">
    <span style="text-align: right;">4 · example sentences</span>
    <span style="background: rgba(127,127,127,0.16); border-radius: 3px; height: 15px; display: block;"><span style="background: #c8702a; height: 15px; width: 57%; display: block; border-radius: 3px;"></span></span>
    <strong style="font-variant-numeric: tabular-nums;">13 / 105</strong>
  </div>
  <div style="display: grid; grid-template-columns: 12em 1fr 7em; gap: 8px; align-items: center; margin-bottom: 7px;">
    <span style="text-align: right;">5 · the 2 code fixes</span>
    <span style="background: rgba(127,127,127,0.16); border-radius: 3px; height: 15px; display: block;"><span style="background: #c8702a; height: 15px; width: 14%; display: block; border-radius: 3px;"></span></span>
    <strong style="font-variant-numeric: tabular-nums;">3 / 98</strong>
  </div>
</div>

<p><em>Suggestions with no real connection to the article they sat under, per round, same 44 saves each time. A pick only counts here after 3 skeptics failed to refute the verdict.</em></p>

## What sits under your article now

Finish something from your readlist and look under it. If a save in your pile genuinely relates, the card names it and gives you one plain sentence for why: "A hands-on build of the transformer internals this visualization walks through." The unread save wins the slot. A past read appears only when nothing unread relates, and when nothing relates at all, there is no card.

The model still overreaches about once in 30 picks, TBH, and one leftover class heals on its own as the duplicate-text rule gathers more evidence. A 6th fix shipped this week and I am grading it the same way as the first 5.

## Save 3 things on the same subject

3 saves on one topic are enough to watch it work. Keep them in [your readlist](/?utm_source=blog-the-next-read-under-your-article-stopped-guessing&utm_medium=internal&utm_content=home), read one tonight, and the card underneath will hand you the second with a reason you can check against your own memory of saving it. The [browser extension](https://readplace.com/install) makes the 3 saves the fast part.
