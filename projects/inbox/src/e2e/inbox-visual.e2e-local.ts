import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	test,
	type VisualCheckpoint,
} from "@packages/e2e-harness";

/** A fixed instant, so the list's wall-clock-relative label is the same on every
 * run and the baseline is not a slowly rotting screenshot of "1 hour ago". */
const RECEIVED_AT = "2026-01-05T10:00:00.000Z";

/** Every state captured here is deliberately poll-free: a card only carries
 * `hx-trigger` while its link is pending, and a panel only while extraction is
 * unfinished, so nothing re-fetches itself underneath the screenshot. Capturing
 * the extracting state would need a poll-freeze seam the app does not yet have. */
const NO_GEOMETRY = async (): Promise<void> => {};

async function seedSettledEmail(page: Page): Promise<string> {
	await page.request.post("/e2e/session");
	await page.request.post("/e2e/seed-address", { data: { name: "e2e" } });
	const seeded = await page.request.post("/e2e/seed-email", {
		data: {
			messageId: "<visual@e2e>",
			receivedAt: RECEIVED_AT,
			senderEmail: "news@example.com",
			subject: "Weekly digest",
			links: [
				{ url: "https://example.com/first", status: "crawled", title: "An example article" },
				{ url: "https://example.com/second", status: "crawled", title: "Another article" },
			],
		},
	});
	assert.equal(seeded.status(), 200, await seeded.text());
	const body = (await seeded.json()) as { emailId: string };
	return body.emailId;
}

const emptyInbox: VisualCheckpoint = {
	name: "inbox-empty",
	settled: async (page) => {
		await expect(page.locator("[data-test-inbox-emails-empty]")).toBeVisible();
	},
	geometry: async (page) => {
		const box = await measuredBox(page, "[data-test-inbox-emails-empty]");
		assert.ok(box.width > 0, "the empty panel must occupy the column");
	},
	target: "main",
	capture: "element",
	pinnedText: [],
};

const addressesPage: VisualCheckpoint = {
	name: "inbox-addresses",
	settled: async (page) => {
		await expect(page.locator("[data-test-inbox-list]")).toHaveAttribute(
			"data-test-inbox-addresses-state",
			"list",
		);
	},
	geometry: NO_GEOMETRY,
	target: "main",
	capture: "element",
	// The address itself carries a freshly minted random token, so pin it —
	// otherwise every run mints a different string and the baseline never matches.
	pinnedText: [{ selector: "[data-test-inbox-name]", text: "e2e" }],
};

const articlesTab: VisualCheckpoint = {
	name: "inbox-articles-terminal",
	settled: async (page) => {
		await expect(page.locator('[data-test-tab-panel="articles"]')).toHaveAttribute(
			"data-articles-status",
			"terminal",
		);
	},
	geometry: NO_GEOMETRY,
	target: "main",
	capture: "element",
	pinnedText: [],
};

test.describe("Inbox visual checkpoints", () => {
	test.use({ timezoneId: "UTC" });

	test("captures the empty inbox", async ({ page }) => {
		await page.request.post("/e2e/session");
		await page.request.post("/e2e/seed-address", { data: { name: "e2e" } });
		await page.goto("/inbox");
		await captureCheckpoint(page, emptyInbox);
	});

	test("captures the addresses page", async ({ page }) => {
		await page.request.post("/e2e/session");
		await page.request.post("/e2e/seed-address", { data: { name: "e2e" } });
		await page.goto("/inbox/addresses");
		await captureCheckpoint(page, addressesPage);
	});

	test("captures a fully terminal Articles tab", async ({ page }) => {
		const emailId = await seedSettledEmail(page);
		await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=articles`);
		await captureCheckpoint(page, articlesTab);
	});
});
