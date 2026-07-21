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
		path: "/screenshots/ios-share-sheet.webp",
		alt: "The iOS share sheet with Readplace as a share target over a Safari article",
		caption: "Tap Share, then choose Readplace.",
	},
	{
		path: "/screenshots/ios-reading-list.webp",
		alt: "The Readplace reading list in the iPhone app",
		caption: "Saved links land in your queue.",
	},
	{
		path: "/screenshots/ios-reader.webp",
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

/** Ordered, static and never animated, unlike the carousel above them: these are
 * a procedure, and a slide that moves on while someone is still following it is
 * a readability problem a numbered list does not have. */
const PIN_STEPS: readonly IosScreenshot[] = [
	{
		path: "/screenshots/ios-share-more.webp",
		alt: "The iOS share sheet with the app row scrolled right to reveal the More button",
		caption: "Tap Share, scroll the row right, then tap More.",
	},
	{
		path: "/screenshots/ios-share-favourite.webp",
		alt: "The iOS Apps screen with Readplace listed under Favourites",
		caption: "Tap Edit, then add Readplace to your Favourites.",
	},
	{
		path: "/screenshots/ios-share-pinned.webp",
		alt: "The iOS share sheet with Readplace first in the app row",
		caption: "Readplace now sits first — no scrolling, no hunting.",
	},
];

interface PinStep {
	src: string;
	alt: string;
	caption: string;
	width: number;
	height: number;
}

function buildPinSteps(staticBaseUrl: string): PinStep[] {
	return PIN_STEPS.map((shot) => ({
		src: `${staticBaseUrl}${shot.path}`,
		alt: shot.alt,
		caption: shot.caption,
		width: SHOT_WIDTH,
		height: SHOT_HEIGHT,
	}));
}

export function HelpAddLinksPage(params: {
	staticBaseUrl: string;
	/** The app-shell "Back to queue" deep link, rendered only when the page is
	 * hosted in the iOS web sheet (`?shell=app`). A browser visitor gets no link —
	 * the `readplace://` scheme would be a dead end there — so the page keeps its
	 * bare public shape by default. Mirrors the account page, the other chromeless
	 * surface the same sheet hosts, so both read "← Back to queue". */
	backLink?: { href: string; label: string };
}): Component {
	return HtmlPage(
		render(HELP_ADD_LINKS_TEMPLATE, {
			backLink: params.backLink,
			// The chromeless sheet ignores the safe area, so the app variant hard-codes
			// the bottom pad that clears the home indicator (see the stylesheet).
			mainClass: params.backLink ? "help help--app" : "help",
			pinSteps: buildPinSteps(params.staticBaseUrl),
			trackSlides: buildTrackSlides(params.staticBaseUrl),
			dots: buildDots(),
		}),
	);
}
