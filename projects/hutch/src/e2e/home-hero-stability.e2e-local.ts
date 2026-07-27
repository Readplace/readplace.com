import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { EXPERIMENT_COOKIE_NAME } from "../runtime/web/experiments/homepage-assignment";
import { HOMEPAGE_SPLIT } from "../runtime/web/experiments/homepage-split";
import { HEADLINE_WORDS } from "../runtime/web/pages/home/home.client";
import { test, waitForBrandFonts } from "./hermetic-cdn";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

const CONTROL_ARM = HOMEPAGE_SPLIT.variants[0];
const CONTROL_ASSIGNMENT = `${HOMEPAGE_SPLIT.campaign}:${HOMEPAGE_SPLIT.epoch}:${CONTROL_ARM.slug}`;

const HOME_CLIENT_BUNDLE = "**/client-dist/home.client.js";

const HERO = {
	title: ".home-hero__title",
	headline: ".hero-headline__visible",
	rotator: ".hero-headline__rotator",
	lead: ".hero-headline__lead",
	wordList: ".home-hero__title .sr-only",
	below: ".home-hero__subtitle",
} as const;

const TOLERANCE_PX = 1;
const VIEWPORT_HEIGHT = 844;
const ROTATOR_UNSTABLE_WIDTHS = [375, 390, 480];

interface HeadlineGeometry {
	reservedHeight: number;
	titleHeight: number;
	headlineHeight: number;
	belowOffset: number;
}

interface WordGeometry {
	word: string;
	geometry: HeadlineGeometry;
}

async function openControlArmHomepage(page: Page): Promise<void> {
	await page.route(HOME_CLIENT_BUNDLE, (route) =>
		route.fulfill({ contentType: "text/javascript", body: "" }),
	);
	await page
		.context()
		.addCookies([{ name: EXPERIMENT_COOKIE_NAME, value: CONTROL_ASSIGNMENT, url: BASE_URL }]);
	await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("body.page-home");
	const bodyClass = await page.locator("body").getAttribute("class");
	assert.ok(bodyClass, "the homepage must identify itself through a body class");
	assert.ok(
		bodyClass.split(" ").includes(`variant-${CONTROL_ARM.marker}`),
		`the ${EXPERIMENT_COOKIE_NAME} cookie must pin the homepage to arm "${CONTROL_ARM.slug}", rendered "${bodyClass}"`,
	);
	await waitForBrandFonts(page, ["Inter"]);
}

async function announcedHeadlineWords(page: Page): Promise<string[]> {
	const announcement = await page.locator(HERO.wordList).textContent();
	const lead = await page.locator(HERO.lead).textContent();
	assert.ok(announcement, `"${HERO.wordList}" must carry the screen-reader headline`);
	assert.ok(lead, `"${HERO.lead}" must carry the visible headline lead`);
	const sentence = announcement.trim();
	const spokenLead = lead.trim();
	assert.ok(
		sentence.startsWith(spokenLead),
		`the screen-reader headline "${sentence}" must open with the visible lead "${spokenLead}"`,
	);
	return sentence
		.slice(spokenLead.length)
		.replace(/\.$/, "")
		.split(",")
		.map((entry) => entry.trim().replace(/^and\s+/, ""));
}

function expectAnnouncementCoversRotation(announced: string[]): void {
	assert.equal(
		[...announced].sort().join(", "),
		[...HEADLINE_WORDS].sort().join(", "),
		"the hero's screen-reader sentence must announce exactly the words the rotator cycles through",
	);
}

async function headlineGeometryShowing(page: Page, word: string): Promise<HeadlineGeometry> {
	const shown = { selectors: HERO, word };
	return await page.evaluate((measured) => {
		const title = document.querySelector(measured.selectors.title);
		const headline = document.querySelector(measured.selectors.headline);
		const rotator = document.querySelector(measured.selectors.rotator);
		const below = document.querySelector(measured.selectors.below);
		if (!title || !headline || !rotator || !below) {
			throw new Error("the hero is missing an element the headline stability guard measures");
		}
		rotator.textContent = measured.word;
		const style = getComputedStyle(title);
		const titleBox = title.getBoundingClientRect();
		return {
			reservedHeight:
				Number.parseFloat(style.lineHeight) * Number(style.getPropertyValue("--hero-headline-lines")),
			titleHeight: titleBox.height,
			headlineHeight: headline.getBoundingClientRect().height,
			belowOffset: below.getBoundingClientRect().top - titleBox.top,
		};
	}, shown);
}

function expectHeadlineHoldsItsBox(measurements: WordGeometry[]): void {
	assert.ok(measurements.length > 1, "the hero must rotate through more than one word");
	const reference = measurements[0];
	for (const { word, geometry } of measurements) {
		assert.ok(
			geometry.reservedHeight > 0,
			`the headline must reserve a box from --hero-headline-lines and its line-height, computed ${geometry.reservedHeight}px`,
		);
		assert.ok(
			Math.abs(geometry.titleHeight - geometry.reservedHeight) <= TOLERANCE_PX,
			`"${word}" must leave the headline at its reserved ${geometry.reservedHeight}px, measured ${geometry.titleHeight}px`,
		);
		assert.ok(
			geometry.headlineHeight <= geometry.reservedHeight + TOLERANCE_PX,
			`"${word}" renders ${geometry.headlineHeight}px of headline inside a ${geometry.reservedHeight}px box, so it is silently clipped`,
		);
		assert.ok(
			Math.abs(geometry.headlineHeight - reference.geometry.headlineHeight) <= TOLERANCE_PX,
			`"${word}" must lay the headline out over the same lines as "${reference.word}" (${reference.geometry.headlineHeight}px), measured ${geometry.headlineHeight}px`,
		);
		assert.ok(
			Math.abs(geometry.belowOffset - reference.geometry.belowOffset) <= TOLERANCE_PX,
			`"${word}" must leave what follows the headline ${reference.geometry.belowOffset}px below its top, measured ${geometry.belowOffset}px`,
		);
	}
}

test.describe("Homepage hero headline holds its box while the word rotates", () => {
	for (const width of ROTATOR_UNSTABLE_WIDTHS) {
		test.describe(`at ${width}px`, () => {
			test.use({ viewport: { width, height: VIEWPORT_HEIGHT } });

			test("no rotating word resizes the headline or moves what follows it", async ({ page }) => {
				await openControlArmHomepage(page);
				expectAnnouncementCoversRotation(await announcedHeadlineWords(page));
				const measurements: WordGeometry[] = [];
				for (const word of HEADLINE_WORDS) {
					measurements.push({ word, geometry: await headlineGeometryShowing(page, word) });
				}
				expectHeadlineHoldsItsBox(measurements);
			});
		});
	}
});
