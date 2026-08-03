import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { expect, test } from "@packages/e2e-harness";

/** A fixed instant rather than a boot-relative offset: the list renders a
 * wall-clock-relative label, so a seeded "1 hour ago" would drift between runs. */
const RECEIVED_AT = "2026-01-05T10:00:00.000Z";

/** Seeds through `page.request` so the session cookie lands in the browser
 * context's jar — the standalone `request` fixture keeps its own, and the page
 * would navigate anonymously. */
async function seedEmailWithPendingLink(page: Page): Promise<string> {
	await page.request.post("/e2e/session");
	await page.request.post("/e2e/seed-address", { data: { name: "e2e" } });
	const seeded = await page.request.post("/e2e/seed-email", {
		data: {
			messageId: "<flow@e2e>",
			receivedAt: RECEIVED_AT,
			senderEmail: "news@example.com",
			subject: "Weekly digest",
			links: [
				{ url: "https://example.com/settled", status: "crawled", title: "A settled article" },
				{ url: "https://example.com/pending", status: "pending" },
			],
		},
	});
	assert.equal(seeded.status(), 200, await seeded.text());
	const body = (await seeded.json()) as { emailId: string };
	return body.emailId;
}

test.describe("Inbox article cards", () => {
	test("resolves a pending card through its own poll without moving keyboard focus", async ({
		page,
	}) => {
		const emailId = await seedEmailWithPendingLink(page);
		await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=articles`);

		const pendingCard = page.locator("#inbox-card-0001");
		await expect(pendingCard).toHaveAttribute("data-card-status", "pending");

		// Focus the control the reader would be reaching for while the card is
		// still resolving — the swap must not pull it out from under them.
		const saveButton = pendingCard.locator("button").first();
		await saveButton.focus();
		const focusedBefore = await page.evaluate(() => document.activeElement?.id);
		assert.ok(focusedBefore, "the save button must take focus");

		await page.request.post("/e2e/resolve-link", {
			data: { receivedAtMessageId: emailId, ordinal: "0001", title: "Now it has a title" },
		});

		// The card's own 3s poll performs the swap; wait for its effect, never for
		// a network-idle heuristic.
		await expect(pendingCard).toHaveAttribute("data-card-status", "terminal", { timeout: 15000 });
		await expect(pendingCard).toContainText("Now it has a title");

		expect(await page.evaluate(() => document.activeElement?.id)).toBe(focusedBefore);
	});

	test("marks a card saved after the save round trip", async ({ page }) => {
		const emailId = await seedEmailWithPendingLink(page);
		await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=articles`);

		const saveControl = page.locator("#inbox-card-0000 [data-test-save-state]");
		await expect(saveControl).toHaveAttribute("data-test-save-state", "unsaved");

		await saveControl.click();

		await expect(page.locator("#inbox-card-0000 [data-test-save-state]")).toHaveAttribute(
			"data-test-save-state",
			"saved",
		);
		await expect(page.locator("#inbox-card-0000 [data-test-save-state]")).toContainText("Saved");
	});
});

test.describe("Inbox address copy control", () => {
	test("unhides the Copy button, which only happens once this page's client bundle is served and runs", async ({
		page,
	}) => {
		await page.request.post("/e2e/session");
		await page.request.post("/e2e/seed-address", { data: { name: "e2e" } });
		await page.goto("/inbox/addresses");

		const copyButton = page.locator("[data-inbox-copy]").first();
		await expect(copyButton).toBeVisible();
		await expect(copyButton).toHaveText("Copy");
	});
});
