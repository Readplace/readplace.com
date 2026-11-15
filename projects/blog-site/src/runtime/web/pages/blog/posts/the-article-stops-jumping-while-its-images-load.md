---
title: "The article stops jumping while its images load"
description: "Readplace measures every image it re-hosts when an article is saved, and the reader reserves that exact box before the bytes arrive, so the paragraph being read holds still while the page finishes loading."
excerpt: "An image that hasn't arrived is 0 pixels tall, and the paragraph under it pays for that."
tldr: "The text of a saved article holds still while its pictures load. Readplace reads each re-hosted image's width and height from the file's own bytes at save time and stores them with the article, so the reader draws an empty box of the picture's exact shape before fetching it. A size is stored only when the file makes it certain, a settled image renders as it did before the change, a failed image gives its space back, and an article saved earlier picks its boxes up on its next recrawl."
slug: "the-article-stops-jumping-while-its-images-load"
date: "2026-11-15"
author: "Fayner Brack"
keywords: "article jumps while images load, reader layout shift, cumulative layout shift, read it later app layout stability, page jumps while reading, text moves while page loads, reserve image space before loading, aspect ratio image box, readplace"
---

Chromium lays out an image it hasn't downloaded yet at 0 by 0 pixels when nothing else names its size. The Readplace reader shows images at their natural size, capped at the column's width, so an unloaded picture used to occupy no room at all. Its bytes arrived, it claimed its full height in a single frame, and the text below it dropped by that much.

One photograph makes that a single hop. A long read can carry 15 of them, each finishing on its own schedule, and the paragraph being read moves every time one lands above it. A selection dragged out for a [highlight](/blog/highlights-and-notes-stay-on-their-passage?utm_source=blog-the-article-stops-jumping-while-its-images-load&utm_medium=internal&utm_content=post-highlights-and-notes-stay-on-their-passage) can be sitting on different words by the time the mouse button comes up.

Now the reader draws an empty box of each picture's exact shape before fetching a byte of it. The text lays out around the box once and stays put.

> **A picture measured at save time costs the layout nothing at render time.**

## The publisher's own numbers say 0 by 0

The web's cure for this is old: write `width` and `height` on the `img` tag, and the browser reserves the shape before the fetch. A reader app can't borrow that cure. Readplace renders a cleaned copy of someone else's markup, and that markup lies about its pictures. Crawled Next.js pages ship `width="0" height="0"` and size each image at runtime, through scripts and styles the saved copy doesn't carry. Honour those attributes and a photo that loaded fine renders invisible.

So the reader sizes images from their actual pixels. That is right once the bytes arrive, and 0 tall before they do.

## Measured from the file at save time

Saving a link already downloads an article's images and re-hosts them beside the stored text, so [the pictures outlast the page](/blog/saved-articles-keep-their-images?utm_source=blog-the-article-stops-jumping-while-its-images-load&utm_medium=internal&utm_content=post-saved-articles-keep-their-images). The save now reads each downloaded file's width and height straight from its bytes and stores the 2 numbers with the article.

The reader turns them into the empty box. The reservation is 1 CSS rule: the measured width, capped at the column, and the picture's aspect ratio. When the photograph arrives it fills a space that was its size all along, and nothing around it moves.

## A box is drawn only when the size is certain

A wrong box jumps twice, once into the wrong shape and once into the right one, so it's worse than no box. A size is stored only when the file makes it certain.

PNG, JPEG and WebP files qualify when they carry no EXIF metadata, because EXIF can tell the browser to rotate the render, and a rotated render swaps the sides of the box. A GIF qualifies when its first frame fits the size its header declares. An image the page offers in several widths through `srcset` gets a box when every copy agrees on the shape, and goes without one when they disagree.

Anything that goes without a box loads the way it did before.

## Loading hands the layout back

The box exists only while the image doesn't. The moment one finishes loading, a small script in the reader removes the reservation, and the settled picture renders exactly as it did before this change. An image that fails gives its space back instead of leaving a blank rectangle the height of a missing photo.

With JavaScript off, no boxes are drawn and the reader behaves as it used to.

Articles saved before this release keep their stored copies, and those copies carry no measurements. They pick their boxes up when a recrawl brings a fresh copy of the page.

## Scroll before the pictures arrive

The difference shows on pages where the pictures outweigh the words: a photo essay, a camera review, a recipe with a shot between every step. Saved from today, such a page lays out once and keeps that layout while the photographs stream in.

[The readlist](/queue?utm_source=blog-the-article-stops-jumping-while-its-images-load&utm_medium=internal&utm_content=readlist) holds the result, and any link pasted at [readplace.com](/?utm_source=blog-the-article-stops-jumping-while-its-images-load&utm_medium=internal&utm_content=home) makes the first measured save.
