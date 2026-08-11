import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { HEADLINE_WORDS } from "../runtime/web/pages/home/home.client";
import { test } from "@packages/e2e-harness";
import { CONTROL_ARM, openHomepage } from "./home-control-arm";
import { measureReservedHeading } from "./reserved-heading.browser";
import {
	type MeasuredHeading,
	TOLERANCE_PX,
	VIEWPORT_HEIGHT,
	expectReservedBoxHeld,
} from "./reserved-heading";

const HERO_HEADING = {
	title: ".home-hero__title",
	content: ".hero-headline__visible",
	below: ".home-hero__subtitle",
	linesProperty: "--hero-headline-lines",
} as const;

const ROTATOR = ".hero-headline__rotator";
const WORD_LIST = ".home-hero__title .sr-only";
const LEAD = ".hero-headline__lead";

const ROTATOR_UNSTABLE_WIDTHS = [375, 390, 480];

async function announcedHeadlineWords(page: Page): Promise<string[]> {
	const announcement = await page.locator(WORD_LIST).textContent();
	const lead = await page.locator(LEAD).textContent();
	assert.ok(announcement, `"${WORD_LIST}" must carry the screen-reader headline`);
	assert.ok(lead, `"${LEAD}" must carry the visible headline lead`);
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

/** Every synonym is one word on one line, so unlike the slogan heading the hero
 * may hold its words to a single shared height rather than a spare-line budget. */
function expectEveryWordFillsTheSameLines(measurements: MeasuredHeading[]): void {
	const reference = measurements[0];
	for (const { shown, geometry } of measurements) {
		assert.ok(
			Math.abs(geometry.contentHeight - reference.geometry.contentHeight) <= TOLERANCE_PX,
			`"${shown}" must lay the headline out over the same lines as "${reference.shown}" (${reference.geometry.contentHeight}px), measured ${geometry.contentHeight}px`,
		);
	}
}

test.describe("Homepage hero headline holds its box while the word rotates", () => {
	for (const width of ROTATOR_UNSTABLE_WIDTHS) {
		test.describe(`at ${width}px`, () => {
			test.use({ viewport: { width, height: VIEWPORT_HEIGHT } });

			test("no rotating word resizes the headline or moves what follows it", async ({ page }) => {
				await openHomepage(page, { variant: CONTROL_ARM, clientBundle: "stubbed" });
				expectAnnouncementCoversRotation(await announcedHeadlineWords(page));
				const measurements: MeasuredHeading[] = [];
				for (const word of HEADLINE_WORDS) {
					await page.locator(ROTATOR).evaluate((rotator, text) => {
						rotator.textContent = text;
					}, word);
					measurements.push({
						shown: word,
						geometry: await page.evaluate(measureReservedHeading, HERO_HEADING),
					});
				}
				expectReservedBoxHeld(measurements, "the hero headline");
				expectEveryWordFillsTheSameLines(measurements);
			});
		});
	}
});
