---
title: "Introducing readlists"
description: "Work reading and weekend reading used to share one pile of saved links. The saved-links page now opens on a rail of tabs: All still catches every save, and beside it sit readlists you name yourself. A list can start from inside the article that made you want one, and an article filed in several lists is marked read in all of them at once."
slug: "sort-your-saves-into-readlists"
date: "2026-09-06"
author: "Fayner Brack"
keywords: "organize read it later saves, multiple reading lists, reading list folders, sort saved articles into lists, create a reading list while reading, readlist, pocket alternative with folders, file articles into lists, read it later organization, readplace"
tags: ["changelog"]
banner: "I gave your saves more than one list to live in"
---

<details class="blog-tldr">
<summary class="blog-tldr__toggle">Summary (TL;DR)</summary>
<div class="blog-tldr__body">

Saved links stop being one long pile. The saved-links page in Readplace now opens on a rail of tabs: All, which still catches every save, and readlists of your own beside it. Filing happens inside the reader, where the menu also takes a name, so a first list can start from the article that made you want one. An article can sit in more than one list, and marking it read once marks it read in every list that holds it.

</div>
</details>

Where does a 40-minute technical paper belong next to the 5-minute essay saved for the weekend? Until this week the answer was the same for every account: in one pile, newest on top, whatever the reason for saving was.

The pile now has tabs.

## All still catches every save

The leftmost tab is called All, and it does the job the old single list did. Every link saved from [the browser extension](https://readplace.com/install), the apps, a newsletter email or a connected chat lands in it, and the save bar lives on it.

The label "My Queue" retired with the single list. A queue promises an order to work through, and a pile of articles saved on impulse doesn't have one. All describes what the tab actually holds.

All can't be renamed and can't be deleted. A catch-all that can vanish is a place to lose links.

## Filing happens in the reader

Filing is a separate decision from saving, made later with the article open. The toolbar in [the reader](/blog/read-any-article-clean-reader?utm_source=blog-sort-your-saves-into-readlists&utm_medium=internal&utm_content=post-read-any-article-clean-reader) carries an Add to readlist menu listing the lists that article isn't in yet. Pick one and the article files at the top of it, a tag appears on the page, and the copy in All stays where it was.

> **Filing is a second decision, taken after the save, with the whole article in front of you.**

One article can carry several tags, and the tag's own control takes it back out of that list.

## A list can start mid-article

The last row of that menu is a name field and a plus button. Type a name, press it, and the list exists with the article you are reading already in it. One submit, no separate create step, no renaming afterwards.

That row shows before you own any list at all, which is the point: the first list is worth making at the moment an article makes the pattern visible, and that moment arrives mid-read.

Type a name you have already used, in any casing, and the article files into that list rather than starting a second one with the same name. All is the one name a new list can't take, because that is where every save already lands.

The row is a plain form, so it works with JavaScript switched off, and a create the server turns down puts you back on the article instead of on an error page. There is a cap on how many lists an account holds. At the cap the row leaves the menu and the lists already there keep filing.

Filing is your decision today. The article and the names you picked are enough for a model to work out where a save belongs, so automatic placement into your readlists is what I'm building next.

## The rail keeps the housekeeping

The tabs on the saved-links page are where lists get renamed and removed. The plus sign at the end makes one from there, and the pencil on a tab renames it in place.

A list's address doesn't follow its name, so renaming one keeps every bookmark to it working.

Each list carries its own delete control and its own confirmation, so removing one doesn't mean opening it first. Deleting leaves you where you were unless the list on screen is the one going away. When you have another list, the question offers to move the articles into it rather than dropping them, and whatever you also have in All stays in All.

## One read state, however many lists

Each list carries its own To Read and Read tabs with their own counts. Mark an article read from any of them and every copy flips at once. Read is a fact about the article, not about the tab it was read from.

## The tabs reached the iPhone before the rail

The To Read and Read tabs are now described by the server itself, and the iPhone app draws them as a segmented control. The rail hasn't made that trip yet, so creating lists and filing into them is on the website for now.

## Name the first one

None of this moved an address. The page is still /queue, a bookmarked filter still opens, and what the extension and the apps write still lands where it did.

Open the next article you save at [readplace.com](/?utm_source=blog-sort-your-saves-into-readlists&utm_medium=internal&utm_content=home) and look at the last row of Add to readlist. The name you type there is the whole setup.
