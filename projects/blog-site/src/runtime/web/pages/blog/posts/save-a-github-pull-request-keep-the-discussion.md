---
title: "Save a GitHub pull request, keep the whole discussion"
description: "A public GitHub pull request saved to Readplace now comes back as the discussion: the opening description, each comment in order, the review decisions and the merge, with inline comments pinned to the file and diff lines they argue about. The generic extractor used to keep page controls instead and dropped the description on all 4 pages checked."
excerpt: "A saved pull request used to open on its page controls, not the author's description."
tldr: "Code review threads are reading material, and the save now treats them that way. A public github.com pull request saved to Readplace comes back as its discussion: the opening description, each comment in the order it was written, the review decisions and the merge, with inline comments pinned to the file and diff lines they argue about. The generic extractor used to score the page's controls above its words and dropped the description on all 4 pages checked. The rule reads only what GitHub serves a signed-out visitor, so a private pull request stays where it is."
slug: "save-a-github-pull-request-keep-the-discussion"
date: "2026-11-22"
author: "Fayner Brack"
keywords: "save github pull request, read github pr later, github pull request reader view, read code review discussions, save code review to read later, read it later for developers, pocket alternative for developers, readplace"
---

Saved for later, a GitHub pull request used to come back as the wrong parts of itself. What the stored copy held was furniture: page controls, or a status fragment, or a commit message folded shut. On the 4 public pull request pages checked, the part a reader would come back for, the author's opening description, was in none of the copies.

That save now works. A public pull request lands in Readplace as the discussion: the description, each comment in the order it was written, the review decisions, the merge, and each inline comment still attached to the lines of code it argues about.

## A page that outscores its own words

The generic extractor behind most reader views, Mozilla's [Readability](/view/github.com/mozilla/readability?utm_source=blog-save-a-github-pull-request-keep-the-discussion&utm_medium=internal&utm_content=read-readability), hunts for the densest block of prose on a page. An article has one. A pull request page scatters its words across dozens of small ones, each comment wrapped in its own buttons, menus and status lines, and the largest single block can turn out to be a collapsed commit message.

So the extractor kept what scored, and what scored was the wrong thing.

> **The discussion was on the page the whole time, spread too thin for an extractor to score.**

## Rebuilt from the signed-out page

Readplace's crawler reads a page the way a visitor without an account does. When the fetched page identifies itself as a pull request in a public repository, a site rule takes over from Readability and rebuilds the article from the discussion itself.

The copy keeps the title and its state, Open, Merged or Closed, with links to the commits and the changed files. Under that sits the opening description, then each comment with its author and timestamp, bots labelled as bots. Task lists turn into plain [x] and [ ] marks, because the reader's HTML keeps no clickable controls, and a folded details block opens flat. A link that jumped within the page now points at the pull request on github.com, so "as discussed above" still lands somewhere.

## An inline comment brings its diff along

A comment left on a line of code is unreadable without the line.

Each inline review thread arrives under the name of its file and the diff rows it sits on, line numbers and plus and minus markers kept, and a thread GitHub marks Outdated carries that label into the copy. Approvals, requested changes and the merge hold their place in the timeline between the comments.

Across the 4 test pages, the rebuilt copies held each opening description, all 24 authored comment blocks and the 5 inline review contexts.

## Signed out is the boundary

The rule runs on a pull request's conversation page alone, the /pull/ URL with a number and nothing after it. The changed-files and commits tabs keep their old behaviour.

It runs only when the fetched page names a public repository and was served to no account. A private repository's page doesn't identify itself that way, and the crawler holds no account to see it with. And when a piece the rule expects is missing, a renamed layout or an absent description block, it steps aside and the save behaves as it did before, rather than storing half a discussion.

Nothing extra is fetched. This is the page the crawl already held, read better.

## Merged is when the reading starts

The pull requests worth a slow read are mostly settled ones: the thread where a team talked itself into an architecture, the long argument under a 10-line change. That read keeps getting postponed because the tab it lives in is built for acting on code, not for reading about it.

Filed into a readlist, the same thread gets a reading time, an AI summary once it's ready, and margins with nothing in them to click. The [browser extension](https://readplace.com/install) takes the conversation tab as it stands. [Stack Overflow threads got the same treatment](/blog/save-a-stack-overflow-question-keep-every-answer?utm_source=blog-save-a-github-pull-request-keep-the-discussion&utm_medium=internal&utm_content=post-save-a-stack-overflow-question-keep-every-answer) in September, and an account at [readplace.com](/?utm_source=blog-save-a-github-pull-request-keep-the-discussion&utm_medium=internal&utm_content=home) covers both kinds of thread.
