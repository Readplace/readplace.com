import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { expect, measuredBox, test, waitForBrandFonts } from "@packages/e2e-harness";

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

for (const javaScriptEnabled of [true, false]) {
	test.describe(`Inbox sender dropdown with JavaScript ${javaScriptEnabled ? "enabled" : "disabled"}`, () => {
		test.use({ javaScriptEnabled });

		test("filters and resets the timeline from the keyboard", async ({ page }) => {
			await seedEmailWithPendingLink(page);
			await page.request.post("/e2e/seed-email", { data: {
				messageId: "<another@e2e>", receivedAt: RECEIVED_AT, senderEmail: "other@example.com", subject: "Another newsletter", links: [],
			} });
			await page.goto("/inbox");
			const menu = page.locator("details[data-test-sender-filter]");
			await menu.locator("summary").press("Enter");
			await expect(menu.getByRole("button", { name: "other@example.com" })).toBeVisible();
			await menu.getByRole("button", { name: "other@example.com" }).press("Enter");
			await expect(page.locator("[data-test-inbox-emails-row]")).toHaveCount(1);
			await expect(menu.locator("summary")).toContainText("other@example.com");
			await menu.locator("summary").press("Space");
			await menu.getByRole("button", { name: "All senders" }).press("Enter");
			await expect(page.locator("[data-test-inbox-emails-row]")).toHaveCount(2);
			await expect(menu.locator("summary")).toContainText("Filter senders");
		});
	});
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
		const saveButton = pendingCard.locator('[data-test-card-action="save"]');
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
		const urlBeforeSave = page.url();

		const saveControl = page.locator("#inbox-card-0000 [data-test-save-state]");
		await expect(saveControl).toHaveAttribute("data-test-save-state", "unsaved");
		await waitForBrandFonts(page, ["Inter"]);
		const unsavedBox = await measuredBox(page, "#inbox-card-0000 [data-test-save-state]");

		await saveControl.click();

		await expect(page.locator("#inbox-card-0000 [data-test-save-state]")).toHaveAttribute(
			"data-test-save-state",
			"saved",
		);
		await expect(page.locator("#inbox-card-0000 [data-test-save-state]")).toContainText("Save again");
		const savedBox = await measuredBox(page, "#inbox-card-0000 [data-test-save-state]");
		assert.ok(
			Math.abs(savedBox.width - unsavedBox.width) <= 0.5,
			`the save button must keep its width once saved, measured unsaved=${unsavedBox.width} saved=${savedBox.width}`,
		);
		expect(page.url()).toBe(urlBeforeSave);
	});
});

test.describe("Inbox skipped links", () => {
	test("saves a skipped row as an article in place, without navigating away from the tab", async ({ page }) => {
		await page.request.post("/e2e/session");
		await page.request.post("/e2e/seed-address", { data: { name: "e2e" } });
		const seeded = await page.request.post("/e2e/seed-email", {
			data: {
				messageId: "<skipped@e2e>",
				receivedAt: RECEIVED_AT,
				senderEmail: "news@example.com",
				subject: "Weekly digest",
				links: [{ url: "https://example.com/sponsored", status: "skipped" }],
			},
		});
		assert.equal(seeded.status(), 200, await seeded.text());
		const { emailId } = (await seeded.json()) as { emailId: string };

		await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=excluded`);
		const urlBeforeSave = page.url();
		const articlesTab = page.locator('[data-test-inbox-tab="articles"]');
		await expect(articlesTab).toHaveText("Extracted Articles (0)");

		await page.locator("#inbox-skipped-0000 [data-test-inbox-excluded-save]").click();

		await expect(page.locator("#inbox-skipped-0000 [data-test-inbox-excluded-moved-notice]")).toContainText(
			"Saved as article.",
		);
		await expect(articlesTab).toHaveText("Extracted Articles (1)");
		expect(page.url()).toBe(urlBeforeSave);
	});
});

test.describe("Inbox address copy control", () => {
	test("unhides the Copy button, which only happens once this page's client bundle is served and runs", async ({
		page,
	}) => {
		await page.request.post("/e2e/session");
		await page.request.post("/e2e/seed-address", { data: { name: "e2e" } });
		await page.goto("/newsletters/custom-emails");

		const copyButton = page.locator("[data-inbox-copy]").first();
		await expect(copyButton).toBeVisible();
		await expect(copyButton).toHaveText("Copy");
	});
});

test.describe("A readlist call is reversible without client JavaScript", () => {
	test.use({ timezoneId: "UTC", javaScriptEnabled: false });

	test("Keep in Work, then the toast's Undo, puts the engine's call back", async ({ page }) => {
		await page.request.post("/e2e/session");
		await page.request.post("/e2e/seed-address", { data: { name: "e2e" } });
		const seeded = await page.request.post("/e2e/seed-email", {
			data: {
				messageId: "<fit-no-js@e2e>",
				receivedAt: RECEIVED_AT,
				senderEmail: "news@example.com",
				subject: "Weekly digest",
				links: [
					{ url: "https://example.com/practice", status: "crawled", title: "Engineering practice" },
					{ url: "https://example.com/launch", status: "crawled", title: "Our spring launch" },
				],
				selectedReadlists: [{ readlist: "work", label: "Work" }],
				eligibleArticleCount: 2,
				savesHeld: false,
				readlistOutcomes: [
					{
						readlist: "work",
						readlistLabel: "Work",
						decision: "filtered",
						fit: [
							{ ordinal: "0000", verdict: "keep", reason: "Engineering practice" },
							{ ordinal: "0001", verdict: "drop", reason: "A product announcement" },
						],
					},
				],
			},
		});
		assert.equal(seeded.status(), 200, await seeded.text());
		const { emailId } = (await seeded.json()) as { emailId: string };
		await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=articles`);

		const launchMarker = page.locator("#inbox-card-0001 [data-test-fit-marker-label]");
		await expect(launchMarker).toHaveText("Not for Work");

		await page.locator('#inbox-card-0001 [data-test-card-action="fit-keep"]').click();

		await expect(page.locator("[data-test-toast-message]")).toHaveText("Adding to Work…");
		await expect(launchMarker).toHaveText("Kept in Work");

		await page.locator("[data-test-toast-action]").click();

		await expect(launchMarker).toHaveText("Not for Work");
		await expect(page.locator("#inbox-card-0001 [data-test-fit-marker-reason]")).toHaveText(
			"A product announcement",
		);
		await expect(page.locator("[data-test-toast]")).toHaveCount(0);
	});
});
test.describe("Removing newsletter links", () => {
	test("the count and the removal each reach their outcome through their own 3s poll", async ({
		page,
	}) => {
		await page.request.post("/e2e/session");
		await page.request.post("/e2e/seed-address", { data: { name: "e2e" } });
		const seeded = await page.request.post("/e2e/seed-email", {
			data: {
				messageId: "<newsletter-links@e2e>",
				receivedAt: RECEIVED_AT,
				senderEmail: "news@example.com",
				subject: "Issue",
			},
		});
		assert.equal(seeded.status(), 200, await seeded.text());
		await page.request.post("/e2e/seed-newsletter-link", {
			data: {
				url: "https://example.com/newsletter-link",
				senderEmail: "news@example.com",
			},
		});
		const finishJob = {
			data: { selected: 3, senderEmail: "news@example.com" },
		};

		await page.goto("/inbox");
		const line = page.locator("#newsletter-links-line");
		await expect(line).toHaveAttribute("data-newsletter-links-state", "offer");
		await line.locator("[data-test-newsletter-links-remove]").click();

		const count = page.locator("#newsletter-links-count");
		await expect(count).toHaveAttribute(
			"data-newsletter-links-count",
			"counting",
		);
		await page.request.post("/e2e/finish-saved-links-job", finishJob);
		await expect(count).toHaveAttribute(
			"data-newsletter-links-count",
			"counted",
			{ timeout: 15000 },
		);
		await expect(page.locator("[data-test-newsletter-links-total]")).toHaveText(
			"3 unread newsletter links in All will be removed.",
		);
		await page.locator("[data-test-newsletter-links-submit]").click();

		await expect(line).toHaveAttribute(
			"data-newsletter-links-state",
			"working",
		);
		await page.request.post("/e2e/finish-saved-links-job", finishJob);
		await expect(line).toHaveAttribute(
			"data-newsletter-links-state",
			"result",
			{ timeout: 15000 },
		);
		await expect(line).toContainText("Removed 3 newsletter links from All.");
	});
});
