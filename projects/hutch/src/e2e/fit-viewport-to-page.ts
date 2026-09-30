import type { Page } from "@playwright/test";
import { documentHeight } from "./gmail-newsletters-visual.browser";

export async function fitViewportToPage(page: Page, viewport: { width: number; height: number }): Promise<void> {
	await page.setViewportSize(viewport);
	const pageHeight = await page.evaluate(documentHeight);
	await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, pageHeight) });
}
