import assert from "node:assert/strict";
import { type Expect, type Page, expect } from "@playwright/test";
import { waitForBrandFonts } from "./hermetic-cdn";

export type CaptureMode = "element" | "page-from-top";

export interface VisualCheckpoint {
	name: string;
	settled: (page: Page) => Promise<void>;
	geometry: (page: Page) => Promise<void>;
	target: string;
	capture: CaptureMode;
	pinnedText: readonly { selector: string; text: string }[];
}

export async function measuredBox(
	page: Page,
	selector: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
	const box = await page.locator(selector).boundingBox();
	assert.ok(box, `"${selector}" must be laid out with a measurable bounding box`);
	return box;
}

async function snapToWholePixels(page: Page, selector: string): Promise<void> {
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

export function initCaptureCheckpoint(deps: { expect: Pick<Expect, "poll" | "soft"> }) {
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
		await page.evaluate((entries) => {
			for (const entry of entries) {
				const pinned = document.querySelector(entry.selector);
				if (!pinned) throw new Error(`pinned text selector "${entry.selector}" matched nothing`);
				pinned.textContent = entry.text;
			}
		}, checkpoint.pinnedText);
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
		await snapToWholePixels(page, checkpoint.target);
		if (checkpoint.capture === "page-from-top") {
			const viewport = page.viewportSize();
			assert.ok(
				viewport,
				`visual checkpoint "${checkpoint.name}": capture "page-from-top" requires a fixed viewport to size the clip`,
			);
			const box = await measuredBox(page, checkpoint.target);
			await deps.expect.soft(page).toHaveScreenshot(`${checkpoint.name}.png`, {
				clip: { x: 0, y: 0, width: viewport.width, height: Math.ceil(box.y + box.height) },
			});
		} else {
			await deps.expect.soft(target).toHaveScreenshot(`${checkpoint.name}.png`);
		}
		await page.evaluate((scroll) => {
			window.scrollTo(scroll.x, scroll.y);
		}, scrollLeftByAction);
	};
}

export const captureCheckpoint = initCaptureCheckpoint({ expect });
