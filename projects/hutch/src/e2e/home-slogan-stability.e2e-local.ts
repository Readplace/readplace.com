import assert from "node:assert/strict";
import { SLOGANS } from "../runtime/web/slogans";
import { test } from "@packages/e2e-harness";
import { CONTROL_ARM, openHomepage } from "./home-control-arm";
import { measureReservedHeading } from "./reserved-heading.browser";
import {
	type MeasuredHeading,
	VIEWPORT_HEIGHT,
	expectReservedBoxHeld,
} from "./reserved-heading";

const TRY_HEADING = {
	title: ".home-try__title",
	content: ".home-try__title",
	below: ".home-try__lede",
	linesProperty: "--home-try-title-lines",
} as const;

const RESERVATION_BRACKET_WIDTHS = [320, 375, 390, 480, 768, 1280];

/** The reservation may exceed what the longest slogan needs by at most one line.
 * It cannot be exact: the heading renders in the system serif, so the Georgia a
 * mac resolves wraps one line wider than the fallback serif on the Linux CI
 * runner, and a bracket sized for the wider of the two over-reserves on the
 * narrower. */
const MAX_SPARE_LINES = 1;

function expectReservationStaysTight(measurements: MeasuredHeading[]): void {
	const longest = Math.max(...measurements.map(({ geometry }) => geometry.contentLines));
	const reserved = measurements[0].geometry.reservedLines;
	assert.ok(
		reserved - longest <= MAX_SPARE_LINES,
		`the heading reserves ${reserved} lines where the longest slogan wraps to ${longest}, leaving ${reserved - longest} lines of dead space above the fold`,
	);
}

test.describe("Homepage heading holds its box while the slogan rotates", () => {
	for (const width of RESERVATION_BRACKET_WIDTHS) {
		test.describe(`at ${width}px`, () => {
			test.use({ viewport: { width, height: VIEWPORT_HEIGHT } });

			test("no slogan resizes the heading or moves what follows it", async ({ page }) => {
				await openHomepage(page, { variant: CONTROL_ARM, clientBundle: "stubbed" });
				const measurements: MeasuredHeading[] = [];
				for (const slogan of SLOGANS) {
					await page.locator(TRY_HEADING.title).evaluate((heading, text) => {
						heading.textContent = text;
					}, slogan);
					measurements.push({
						shown: slogan,
						geometry: await page.evaluate(measureReservedHeading, TRY_HEADING),
					});
				}
				expectReservedBoxHeld(measurements, "the try heading");
				expectReservationStaysTight(measurements);
			});
		});
	}
});
