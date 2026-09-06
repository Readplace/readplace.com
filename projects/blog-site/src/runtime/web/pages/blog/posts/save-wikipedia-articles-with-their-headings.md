---
title: "The Edit Link That Deleted the Heading"
description: "Saving a Wikipedia article used to flatten it into one column, with a stray '[edit]' where every section heading had been. The cleaner that strips page clutter was counting the edit link beside each heading as clutter and taking the heading with it. Readplace now clears those edit links before the cleaner scores the page, so the headings survive."
slug: "save-wikipedia-articles-with-their-headings"
date: "2026-07-18"
author: "Fayner Brack"
keywords: "save wikipedia article to read later, read wikipedia offline clean, wikipedia read it later, save wiki page read later, clean reader keeps headings, read long wikipedia article later, save mediawiki page read later, read wikipedia without clutter, save encyclopedia article to read later, wikipedia article no edit links"
tags: ["changelog"]
banner: "I kept the section headings on saved Wikipedia pages"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Section headings are what make a long Wikipedia entry skimmable, and a saved copy that loses them is harder to read than the page it came from. Readplace used to lose them. It runs each saved page through Mozilla Readability, the cleaner behind browser reader modes, and Readability deletes a short block when most of its text sits inside links. MediaWiki wraps every section heading in a div with an "edit" link beside it, so that wrapper read as mostly-link and Readability took the whole thing, heading included. Saved Wikipedia articles came back as one flat column with stray "[edit]" text where the headings belonged. The fix strips the `.mw-editsection` edit links before Readability scores the page, which leaves each heading as a plain block with no links, and Readability keeps it. It runs as a pre-pass that only removes edit chrome, so it leaves body text alone, and it fires on any MediaWiki page, detected by the `generator` meta tag rather than the domain, so a distribution's wiki or a fan reference gets it too. On real pages the headings came back, the Mythical Man-Month from 0 to 6 and Bioluminescence from 0 to 11, while a page that was already correct stayed put. The crawler's health check now saves the Bioluminescence article every run and fails if a section heading goes missing, so the fix can't regress unnoticed.

</div>
</details>

Every section heading had gone missing from the saved copy of a Wikipedia article. A stray "[edit]" sat where each one used to be, and the entry that should have broken into parts ran as one long column instead.

The live page was fine. In a browser, the same address shows each heading where the writer put it, one to a section, an outline to skim before committing to the read. Readplace had kept the words and lost the shape.

So the reader copy held the full body and none of its structure. That put the fault in the step that turns a fetched page into [the clean article you keep](/blog/read-any-article-clean-reader?utm_source=blog-save-wikipedia-articles-with-their-headings&utm_medium=internal&utm_content=post-read-any-article-clean-reader).

## The rule that deletes link menus

Readplace runs each saved page through [Mozilla Readability](/view/github.com/mozilla/readability?utm_source=blog-save-wikipedia-articles-with-their-headings&utm_medium=internal&utm_content=read-github-com), the same library behind a browser's reader mode. It scores every block on the page and drops the parts that read as chrome: navigation, sidebars, boxes of related links. Most of the time it keeps the article and leaves the furniture behind.

On a Wikipedia page it was dropping the headings too. A plain `<h2>` should be the easiest thing on the page to keep, so the question was what made this one look disposable.

The answer is in how MediaWiki builds a heading. Its current skin, [Vector 2022](/view/www.mediawiki.org/wiki/Skin:Vector_2022?utm_source=blog-save-wikipedia-articles-with-their-headings&utm_medium=internal&utm_content=read-www-mediawiki-org), doesn't emit a bare `<h2>`. It wraps the heading and an edit link together in one div: the `<h2>` with the section title, and beside it a `<span class="mw-editsection">` holding the bracketed `[edit]` link that lets a signed-in editor jump straight to that section.

That edit link is the whole problem. Readability has a rule, `_cleanConditionally`, that deletes a short div when most of its text sits inside links. The rule is usually right, because a small block that is mostly links is a menu or a related-stories strip, not prose. It works out link density, the share of a block's text wrapped in an anchor.

The heading wrapper is short and holds one link. Against those few words of heading, a single anchor is enough to send the link density high. Readability read the wrapper as a mostly-link box and deleted it, and the `<h2>` inside went with it. The heading and its edit link left together.

> **The rule that strips link menus was stripping headings, because MediaWiki hangs an edit link off every one.**

## Clearing the edit link first

The fix runs before Readability scores anything. Readplace walks the page and removes the `.mw-editsection` spans, the edit links and nothing besides. What's left is a plain heading div with no link in it, link density zero, which Readability keeps the way it keeps a heading that arrives on its own.

It runs as a pre-pass, not a replacement. Readplace doesn't tell Readability which block is the article. It clears the edit chrome, then lets Readability score the whole page and choose the body as it would on any other site. The change takes away a reason to delete a heading. It doesn't add a word of body text or remove one.

The detection had to be careful. MediaWiki runs far past Wikipedia, on a Linux distribution's handbook, a game's fan wiki, a company's internal docs. So the rule can't match on the wikipedia.org address. It reads the page for the `<meta name="generator" content="MediaWiki …">` tag that MediaWiki writes into every page it renders, and leaves any page without that tag untouched, whatever its domain.

## The headings that came back

Run against real saved pages, the pre-pass put the structure back and left the healthy pages alone. The Mythical Man-Month went from 0 headings to 6. [Bioluminescence](/view/en.wikipedia.org/wiki/Bioluminescence?utm_source=blog-save-wikipedia-articles-with-their-headings&utm_medium=internal&utm_content=read-en-wikipedia-org) went from 0 to 11. The Great Barrier Reef article, which Readability had been handling correctly all along, stayed at 10 and 10. Because the pre-pass only takes out edit links, a page that didn't have the problem doesn't notice it ran.

```rp-figure
kind: bars
title: Section headings kept on three real saved pages
note: The pre-pass only takes out edit links, so a page that was already correct stays where it was.
before: Before the pre-pass
after: After the pre-pass
row: The Mythical Man-Month | 0 | 0 headings | 6 | 6 headings
row: Bioluminescence | 0 | 0 headings | 11 | 11 headings
row: The Great Barrier Reef | 10 | 10 headings | 10 | 10 headings
```

> **Bioluminescence came back with 11 headings. A page that was already right stayed exactly as it was.**

## A check that fails if a heading goes missing

A fix like this sits one recrawl away from breaking again. Readability updates, or the skin's markup shifts, and the headings could vanish a second time with nothing watching for it. So the crawler's health check now watches for it directly.

The check saves the Bioluminescence article on every run and reads the clean copy back. It asserts the heading "Chemical mechanism" is there. If the MediaWiki rule regresses, that heading drops out and the check turns red before a reader meets a flattened page.

It looks for the surviving heading, not the leaked edit text, and that's deliberate. The reader escapes angle brackets before it renders, so the raw edit markup doesn't appear literally to test against. The missing heading is the signal that holds. The page also had to be one the recrawl truly re-parses. An older Wikipedia save sat in storage as a copy the recrawl leaves as-is, so the fix wouldn't show there, while Bioluminescence is fetched fresh each recrawl and tracks the live rule.

## Save a page and get its outline back

Save a long Wikipedia entry now and the headings ride along with the text, the outline intact and the "[edit]" litter gone. The same holds for any site built on MediaWiki, a distribution's manual or a fan-run reference, because the rule reads the software behind the page, not the name in front of it.

An encyclopedia entry you mean to read later is worth more with its parts still marked. Pick one of those long articles you keep meaning to get to, [a copy that keeps its shape past the day the live page moves on](/blog/saved-articles-outlast-the-original-page?utm_source=blog-save-wikipedia-articles-with-their-headings&utm_medium=internal&utm_content=post-saved-articles-outlast-the-original-page), and send it in through [the browser extension](https://readplace.com/install) or by dropping the link at [readplace.com](/?utm_source=blog-save-wikipedia-articles-with-their-headings&utm_medium=internal&utm_content=home). The headings will be where the writer left them.
