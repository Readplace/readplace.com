import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert";
import { HtmlPage, render } from "@packages/web-shell";
import type { Component } from "@packages/web-shell";

const HELP_ADD_LINKS_TEMPLATE = readFileSync(
	join(__dirname, "add-links.template.html"),
	"utf-8",
);

interface IosScreenshot {
	path: string;
	alt: string;
	caption: string;
}

const SHOT_WIDTH = 520;
const SHOT_HEIGHT = 1127;

/** Captions are written for someone who already has the app and just tapped +,
 * so they teach the Share flow rather than reusing the acquisition copy the same
 * three rasters carry on /install. */
const IOS_SCREENSHOTS: readonly IosScreenshot[] = [
	{
		path: "/screenshots/ios-share-sheet.png",
		alt: "The iOS share sheet with Readplace as a share target over a Safari article",
		caption: "Tap Share, then choose Readplace.",
	},
	{
		path: "/screenshots/ios-reading-list.png",
		alt: "The Readplace reading list in the iPhone app",
		caption: "Saved links land in your queue.",
	},
	{
		path: "/screenshots/ios-reader.png",
		alt: "The Readplace reader on iPhone showing an article with its AI summary",
		caption: "Read them later, clean — with a TL;DR.",
	},
];

assert(
	IOS_SCREENSHOTS.length === 3,
	"the carousel CSS hard-codes three slides, three dots and a four-slide track",
);

interface TrackSlide {
	src: string;
	alt: string;
	caption: string;
	width: number;
	height: number;
	loopClass: string;
	ariaHidden?: "true";
}

interface CarouselDot {
	positionClass: string;
}

function toSlide(shot: IosScreenshot, staticBaseUrl: string): TrackSlide {
	return {
		src: `${staticBaseUrl}${shot.path}`,
		alt: shot.alt,
		caption: shot.caption,
		width: SHOT_WIDTH,
		height: SHOT_HEIGHT,
		loopClass: "",
	};
}

/** The track slides 0 → -100% → -200% → -300%; at -300% this clone of the first
 * screenshot is on screen, so restarting the loop at 0% is a zero-pixel jump
 * instead of a rewind sweep back across every slide. */
function toLoopClone(first: TrackSlide): TrackSlide {
	return { ...first, alt: "", loopClass: " help__slide--loop", ariaHidden: "true" };
}

function buildTrackSlides(staticBaseUrl: string): TrackSlide[] {
	const slides = IOS_SCREENSHOTS.map((shot) => toSlide(shot, staticBaseUrl));
	const [first] = slides;
	assert(first, "IOS_SCREENSHOTS is non-empty, so the mapped slides are too");
	return [...slides, toLoopClone(first)];
}

function buildDots(): CarouselDot[] {
	return IOS_SCREENSHOTS.map((_shot, index) => ({
		positionClass: `help__dot--${index + 1}`,
	}));
}

export function HelpAddLinksPage(params: { staticBaseUrl: string }): Component {
	return HtmlPage(
		render(HELP_ADD_LINKS_TEMPLATE, {
			trackSlides: buildTrackSlides(params.staticBaseUrl),
			dots: buildDots(),
		}),
	);
}
