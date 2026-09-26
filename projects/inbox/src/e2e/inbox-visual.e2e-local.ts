import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	test,
	type VisualCheckpoint,
} from "@packages/e2e-harness";
import { pinCopyableAddresses } from "./inbox-visual.browser";

/** A fixed instant, so the list's wall-clock-relative label is the same on every
 * run and the baseline is not a slowly rotting screenshot of "1 hour ago". */
const RECEIVED_AT = "2026-01-05T10:00:00.000Z";

const NO_GEOMETRY = async (): Promise<void> => {};

const WORK_READLIST = "work";

interface SeedLink {
	url: string;
	status: "crawled" | "skipped";
	title?: string;
	droppedFor?: { readlist: string; readlistLabel: string; reason: string };
}

const TWO_CRAWLED_LINKS: readonly SeedLink[] = [
	{ url: "https://example.com/first", status: "crawled", title: "An example article" },
	{ url: "https://example.com/second", status: "crawled", title: "Another article" },
];

const DECIDED_LINKS: readonly SeedLink[] = [
	{ url: "https://example.com/first", status: "crawled", title: "An example article" },
	{
		url: "https://example.com/spring-launch",
		status: "crawled",
		title: "Our spring launch",
		droppedFor: {
			readlist: WORK_READLIST,
			readlistLabel: "Work",
			reason: "A product announcement, not engineering practice",
		},
	},
	{
		url: "https://example.com/careers",
		status: "crawled",
		title: "We're hiring",
		droppedFor: { readlist: WORK_READLIST, readlistLabel: "Work", reason: "" },
	},
	{ url: "https://example.com/unsubscribe", status: "skipped" },
];

async function copyButtonSeatedInField(page: Page): Promise<void> {
	const fields = await page.locator(".inbox-copyable").all();
	assert.ok(fields.length > 0, "the surface must render at least one copyable address");

	for (const field of fields) {
		const fieldBox = await field.boundingBox();
		const buttonBox = await field.locator(".inbox-copyable__copy").boundingBox();
		assert.ok(fieldBox, "the copyable box must be laid out with a measurable bounding box");
		assert.ok(buttonBox, "the Copy button must be laid out with a measurable bounding box");

		const minHeight = await field.evaluate((el) => getComputedStyle(el).minHeight);
		assert.equal(
			`${fieldBox.height}px`,
			minHeight,
			"the copyable box must stay the shared field height, so it lines up with the plain address fields beside it",
		);

		const afterButton = fieldBox.x + fieldBox.width - (buttonBox.x + buttonBox.width);
		const aboveButton = buttonBox.y - fieldBox.y;
		const belowButton = fieldBox.y + fieldBox.height - (buttonBox.y + buttonBox.height);
		assert.equal(
			afterButton,
			aboveButton,
			`the gap after the Copy button must match the one above it, or the field ends in dead space (after ${afterButton}px, above ${aboveButton}px)`,
		);
		assert.equal(
			afterButton,
			belowButton,
			`the gap after the Copy button must match the one below it, or the field ends in dead space (after ${afterButton}px, below ${belowButton}px)`,
		);
	}
}

async function copyableAddressReady(page: Page): Promise<void> {
	await expect(page.locator(".inbox-copyable__copy").first()).toBeVisible();
}

async function pinMintedAddress(page: Page): Promise<void> {
	await page.evaluate(pinCopyableAddresses, "e2e-pinned@read.place");
}

async function seedEmail(
	page: Page,
	seed: { links: readonly SeedLink[]; readlistDecision?: Record<string, string> },
): Promise<string> {
	await page.request.post("/e2e/session");
	await page.request.post("/e2e/seed-address", { data: { name: "e2e" } });
	const seeded = await page.request.post("/e2e/seed-email", {
		data: {
			messageId: "<visual@e2e>",
			receivedAt: RECEIVED_AT,
			senderEmail: "news@example.com",
			subject: "Weekly digest",
			...seed,
		},
	});
	assert.equal(seeded.status(), 200, await seeded.text());
	const body = (await seeded.json()) as { emailId: string };
	return body.emailId;
}

async function holdPanelPollThenSpendBudget(page: Page): Promise<() => void> {
	let release: (() => void) | undefined;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	assert.ok(release, "a promise executor runs synchronously, so its resolver must be captured");
	await page.route("**/articles?poll=*", async (route) => {
		await held;
		const spent = new URL(route.request().url());
		spent.searchParams.set("poll", String(Number.MAX_SAFE_INTEGER));
		await route.continue({ url: spent.toString() });
	});
	return release;
}

function articlesPanelSettled(input: {
	status: string;
	region: string;
}): VisualCheckpoint["settled"] {
	return async (page) => {
		await expect(page.locator('[data-test-tab-panel="articles"]')).toHaveAttribute(
			"data-articles-status",
			input.status,
		);
		await expect(page.locator(input.region)).toBeVisible();
	};
}

const emptyInbox: VisualCheckpoint = {
	name: "inbox-empty",
	settled: async (page) => {
		await expect(page.locator("[data-test-inbox-emails-empty]")).toBeVisible();
		await copyableAddressReady(page);
		await pinMintedAddress(page);
	},
	geometry: async (page) => {
		const box = await measuredBox(page, "[data-test-inbox-emails-empty]");
		assert.ok(box.width > 0, "the empty panel must occupy the column");
		await copyButtonSeatedInField(page);
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
		await copyableAddressReady(page);
		await pinMintedAddress(page);
	},
	geometry: copyButtonSeatedInField,
	target: "main",
	capture: "element",
	pinnedText: [],
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

const articlesDeciding: VisualCheckpoint = {
	name: "inbox-articles-deciding",
	settled: articlesPanelSettled({
		status: "deciding",
		region: '[data-test-panel-notice="deciding"]',
	}),
	geometry: NO_GEOMETRY,
	target: "main",
	capture: "element",
	pinnedText: [],
};

const articlesDecisionStale: VisualCheckpoint = {
	name: "inbox-articles-decision-stale",
	settled: articlesPanelSettled({
		status: "terminal",
		region: '[data-test-panel-alert="decision-stale"]',
	}),
	geometry: NO_GEOMETRY,
	target: "main",
	capture: "element",
	pinnedText: [],
};

const articlesDecided: VisualCheckpoint = {
	name: "inbox-articles-decided",
	settled: articlesPanelSettled({
		status: "terminal",
		region: '[data-test-panel-notice="decided"]',
	}),
	geometry: NO_GEOMETRY,
	target: "main",
	capture: "element",
	pinnedText: [],
};

const articlesDecisionFailed: VisualCheckpoint = {
	name: "inbox-articles-decision-failed",
	settled: articlesPanelSettled({
		status: "terminal",
		region: '[data-test-panel-alert="decision-failed"]',
	}),
	geometry: NO_GEOMETRY,
	target: "main",
	capture: "element",
	pinnedText: [],
};

const skippedWithDropped: VisualCheckpoint = {
	name: "inbox-skipped-dropped",
	settled: async (page) => {
		await expect(page.locator('[data-test-tab-panel="excluded"]')).toHaveAttribute(
			"data-excluded-status",
			"terminal",
		);
		await expect(page.locator('[data-test-panel-notice="dropped-note"]')).toBeVisible();
		await expect(page.locator("[data-test-inbox-excluded-link]")).toHaveCount(3);
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
		const emailId = await seedEmail(page, { links: TWO_CRAWLED_LINKS });
		await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=articles`);
		await captureCheckpoint(page, articlesTab);
	});

	test("captures the Articles tab while its readlist decides, then its still-choosing give-up", async ({
		page,
	}) => {
		const emailId = await seedEmail(page, {
			links: TWO_CRAWLED_LINKS,
			readlistDecision: { state: "deciding", readlist: WORK_READLIST },
		});
		const releasePoll = await holdPanelPollThenSpendBudget(page);
		await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=articles`);
		await captureCheckpoint(page, articlesDeciding);
		releasePoll();
		await captureCheckpoint(page, articlesDecisionStale);
	});

	test("captures the Articles tab once its readlist decided", async ({ page }) => {
		const emailId = await seedEmail(page, {
			links: DECIDED_LINKS,
			readlistDecision: { state: "decided", readlist: WORK_READLIST, readlistLabel: "Work" },
		});
		await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=articles`);
		await captureCheckpoint(page, articlesDecided);
	});

	test("captures the Articles tab when its readlist could not decide", async ({ page }) => {
		const emailId = await seedEmail(page, {
			links: TWO_CRAWLED_LINKS,
			readlistDecision: { state: "failed", readlist: WORK_READLIST },
		});
		await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=articles`);
		await captureCheckpoint(page, articlesDecisionFailed);
	});

	test("captures the Skipped tab listing the links its readlist dropped", async ({ page }) => {
		const emailId = await seedEmail(page, {
			links: DECIDED_LINKS,
			readlistDecision: { state: "decided", readlist: WORK_READLIST, readlistLabel: "Work" },
		});
		await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=excluded`);
		await captureCheckpoint(page, skippedWithDropped);
	});
});
