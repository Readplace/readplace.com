import assert from "node:assert/strict";
import { type Expect, type Page, type TestInfo, expect, test } from "@playwright/test";
import { waitForBrandFonts } from "./hermetic-cdn";

export type CaptureMode = "element" | "page-from-top";

export interface VisualCheckpoint {
	name: string;
	settled: (page: Page) => Promise<void>;
	geometry: (page: Page) => Promise<void>;
	target: string;
	capture: CaptureMode;
	pinnedText: readonly { selector: string; text: string }[];
	maxDiffPixelRatio?: number;
}

const SHELL_USER_EMAIL_SELECTOR = "[data-test-nav-user-email]";

const SHELL_USER_EMAIL_PLACEHOLDER = "reader@example.com";

export async function measuredBox(
	page: Page,
	selector: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
	const box = await page.locator(selector).boundingBox();
	assert.ok(box, `"${selector}" must be laid out with a measurable bounding box`);
	return box;
}

export async function snapToWholePixels(page: Page, selector: string): Promise<void> {
	await page.evaluate((sel) => {
		const el = document.querySelector<HTMLElement>(sel);
		if (!el) throw new Error(`snap target "${sel}" matched nothing`);
		if (window.getComputedStyle(el).transform !== "none") return;
		const box = el.getBoundingClientRect();
		const dx = Math.round(box.x) - box.x;
		const dy = Math.round(box.y) - box.y;
		if (dx === 0 && dy === 0) return;
		el.style.transform = `translate(${dx}px, ${dy}px)`;
	}, selector);
}

const BUTTON_SELECTOR = ".btn";

async function mixedHeightButtonRow(page: Page, target: string): Promise<string | null> {
	return page.evaluate(
		(scan) => {
			for (const root of document.querySelectorAll(scan.target)) {
				for (const row of [root, ...root.querySelectorAll("*")]) {
					const buttons = Array.from(
						row.querySelectorAll<HTMLElement>(`:scope > ${scan.button}, :scope > * > ${scan.button}`),
						(button) => ({ label: button.innerText.trim(), box: button.getBoundingClientRect() }),
					).filter((button) => button.box.height > 0);
					for (const [index, button] of buttons.entries()) {
						for (const beside of buttons.slice(index + 1)) {
							const sameBand = button.box.top < beside.box.bottom && beside.box.top < button.box.bottom;
							if (sameBand && Math.abs(button.box.height - beside.box.height) > 1) {
								return `"${button.label}" is ${button.box.height}px beside "${beside.label}" at ${beside.box.height}px`;
							}
						}
					}
				}
			}
			return null;
		},
		{ target, button: BUTTON_SELECTOR },
	);
}

const SCREENSHOT_OPTIONS = { animations: "disabled", caret: "hide", scale: "css" } as const;

export function initCaptureCheckpoint(deps: {
	expect: Pick<Expect, "poll" | "soft">;
	testInfo: () => Pick<TestInfo, "attach" | "errors">;
}) {
	return async function captureCheckpoint(
		page: Page,
		checkpoint: VisualCheckpoint,
	): Promise<void> {
		await checkpoint.settled(page);
		const scrollLeftByAction = await page.evaluate(() => ({
			x: window.scrollX,
			y: window.scrollY,
		}));
		await waitForBrandFonts(page, ["Inter"]);
		const target = page.locator(checkpoint.target);
		const matched = await target.count();
		assert.ok(
			matched > 0,
			`visual checkpoint "${checkpoint.name}": target "${checkpoint.target}" matched 0 elements`,
		);
		await page.evaluate(
			(pins) => {
				for (const entry of pins.required) {
					const pinned = document.querySelector(entry.selector);
					if (!pinned) throw new Error(`pinned text selector "${entry.selector}" matched nothing`);
					pinned.textContent = entry.text;
				}
				for (const shellEmail of document.querySelectorAll(pins.shellEmail.selector)) {
					shellEmail.textContent = pins.shellEmail.text;
				}
			},
			{
				required: checkpoint.pinnedText,
				shellEmail: { selector: SHELL_USER_EMAIL_SELECTOR, text: SHELL_USER_EMAIL_PLACEHOLDER },
			},
		);
		let previousBox = "";
		await deps.expect
			.poll(async () => {
				const box = await measuredBox(page, checkpoint.target);
				const current = JSON.stringify(box);
				const stable = current === previousBox;
				previousBox = current;
				return stable;
			})
			.toBe(true);
		await checkpoint.geometry(page);
		const mixedRow = await mixedHeightButtonRow(page, checkpoint.target);
		assert.equal(
			mixedRow,
			null,
			`visual checkpoint "${checkpoint.name}": ${mixedRow} — buttons sharing a row share one size`,
		);
		await snapToWholePixels(page, checkpoint.target);
		const budgetArgs: [budget?: { maxDiffPixelRatio: number }] =
			checkpoint.maxDiffPixelRatio === undefined
				? []
				: [{ maxDiffPixelRatio: checkpoint.maxDiffPixelRatio }];
		const testInfo = deps.testInfo();
		const errorsBeforeComparison = testInfo.errors.length;
		let captureSettledImage: () => Promise<Buffer>;
		if (checkpoint.capture === "page-from-top") {
			const viewport = page.viewportSize();
			assert.ok(
				viewport,
				`visual checkpoint "${checkpoint.name}": capture "page-from-top" requires a fixed viewport to size the clip`,
			);
			const box = await measuredBox(page, checkpoint.target);
			const clip = { x: 0, y: 0, width: viewport.width, height: Math.ceil(box.y + box.height) };
			await deps.expect.soft(page).toHaveScreenshot(`${checkpoint.name}.png`, {
				clip,
				...budgetArgs[0],
			});
			captureSettledImage = () => page.screenshot({ clip, ...SCREENSHOT_OPTIONS });
		} else {
			await deps.expect.soft(target).toHaveScreenshot(`${checkpoint.name}.png`, ...budgetArgs);
			captureSettledImage = () => target.screenshot(SCREENSHOT_OPTIONS);
		}
		if (testInfo.errors.length === errorsBeforeComparison) {
			await testInfo.attach(`${checkpoint.name}.png`, {
				body: await captureSettledImage(),
				contentType: "image/png",
			});
		}
		await page.evaluate((scroll) => {
			window.scrollTo(scroll.x, scroll.y);
		}, scrollLeftByAction);
	};
}

export const captureCheckpoint = initCaptureCheckpoint({ expect, testInfo: test.info });
