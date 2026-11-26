import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import {
	captureCheckpoint,
	expect,
	measuredBox,
	snapToWholePixels,
	test,
	type VisualCheckpoint,
} from "@packages/e2e-harness";
import { INBOX_EMAILS_PAGE_SIZE } from "../runtime/web/pages/inbox/inbox-emails.url";
import { pinCopyableAddresses } from "./inbox-visual.browser";

/** A fixed instant, so the list's wall-clock-relative label is the same on every
 * run and the baseline is not a slowly rotting screenshot of "1 hour ago". */
const RECEIVED_AT = "2026-01-05T10:00:00.000Z";
const FIRST_ARTICLE_CARD = '[data-test-inbox-article-card="0000"]';
const FIRST_ARTICLE_MENU = `${FIRST_ARTICLE_CARD} [data-test-inbox-article-menu]`;

const NO_GEOMETRY = async (): Promise<void> => {};

const WORK_READLIST = "work";

interface SeedLink {
	url: string;
	status: "crawled" | "skipped";
	title?: string;
}

interface SeedReadlistOutcome {
	readlist: string;
	readlistLabel: string;
	decision: "filtered" | "no-purpose" | "readlist-missing" | "smart-matching" | "failed";
	fit: { ordinal: string; verdict: "keep" | "drop" | "unsure"; reason: string }[];
}

const TWO_CRAWLED_LINKS: readonly SeedLink[] = [
	{ url: "https://example.com/first", status: "crawled", title: "An example article" },
	{ url: "https://example.com/second", status: "crawled", title: "Another article" },
];

interface SeedFitOverride {
	readlist: string;
	ordinal: string;
	readerVerdict: "keep" | "drop";
	createdAt: string;
}

const WORK_FIT_WITH_UNSURE: SeedReadlistOutcome = {
	readlist: WORK_READLIST,
	readlistLabel: "Work",
	decision: "filtered",
	fit: [
		{ ordinal: "0000", verdict: "keep", reason: "Engineering practice" },
		{ ordinal: "0001", verdict: "drop", reason: "A product announcement, not engineering practice" },
		{ ordinal: "0002", verdict: "unsure", reason: "" },
	],
};

const ROUTED_LINKS: readonly SeedLink[] = [
	{ url: "https://example.com/first", status: "crawled", title: "An example article" },
	{ url: "https://example.com/spring-launch", status: "crawled", title: "Our spring launch" },
	{ url: "https://example.com/careers", status: "crawled", title: "We're hiring" },
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

const PINNED_DETAIL_RECIPIENT = [
	{ selector: "[data-test-inbox-detail-recipient]", text: "to e2e-pinned@read.place" },
];

const PINNED_LIST_RECIPIENT = [{ selector: ".inbox-emails__recipient-name", text: "e2e-pinned@read.place" }];

async function copyableAddressReady(page: Page): Promise<void> {
	await expect(page.locator(".inbox-copyable__copy").first()).toBeVisible();
}

async function pinMintedAddress(page: Page): Promise<void> {
	await page.evaluate(pinCopyableAddresses, "e2e-pinned@read.place");
}

async function seedEmail(
	page: Page,
	seed: {
		links: readonly SeedLink[];
		selectedReadlists?: { readlist: string; label: string }[];
		readlistOutcomes?: SeedReadlistOutcome[];
		fitOverrides?: SeedFitOverride[];
		eligibleArticleCount?: number;
		savesHeld?: boolean;
	},
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

const createdToast: VisualCheckpoint = {
	name: "inbox-created-toast",
	settled: async (page) => {
		const toast = page.locator("[data-test-toast]");
		await expect(toast).toBeVisible();
		await expect(toast.locator("[data-test-toast-message]")).toHaveText(
			'Created the custom email "e2e" — it\'s live in the list below',
		);
		await expect(toast.locator("[data-test-toast-action]")).toHaveCount(0);
	},
	geometry: NO_GEOMETRY,
	target: "[data-test-toast]",
	capture: "element",
	pinnedText: [],
};

const addressAlert: VisualCheckpoint = {
	name: "inbox-alert",
	settled: async (page) => {
		await expect(page.locator('[data-test-alert="limit"]')).toHaveAttribute(
			"data-test-alert-variant",
			"error",
		);
		await expect(page.locator('[data-test-alert="limit"]')).toHaveClass(/alert--visible/);
		await expect(page.locator('[data-test-alert="limit"]')).toHaveAttribute("role", "alert");
	},
	geometry: NO_GEOMETRY,
	target: '[data-test-alert="limit"]',
	capture: "element",
	pinnedText: [],
};

const emailDetailAlert: VisualCheckpoint = {
	name: "inbox-email-detail-alert",
	settled: async (page) => {
		await expect(page.locator('[data-test-alert="email-unavailable"]')).toHaveAttribute(
			"data-test-alert-variant",
			"error",
		);
		await expect(page.locator('[data-test-alert="email-unavailable"]')).toHaveClass(/alert--visible/);
		await expect(page.locator('[data-test-alert="email-unavailable"]')).toHaveAttribute(
			"role",
			"alert",
		);
	},
	geometry: NO_GEOMETRY,
	target: '[data-test-alert="email-unavailable"]',
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
	pinnedText: PINNED_DETAIL_RECIPIENT,
};

const articlesDeciding: VisualCheckpoint = {
	name: "inbox-articles-deciding",
	settled: articlesPanelSettled({
		status: "terminal",
		region: '[data-test-panel-notice="deciding"]:has-text("Choosing articles for")',
	}),
	geometry: NO_GEOMETRY,
	target: "main",
	capture: "element",
	pinnedText: PINNED_DETAIL_RECIPIENT,
};

const articlesDecisionStale: VisualCheckpoint = {
	name: "inbox-articles-decision-stale",
	settled: articlesPanelSettled({
		status: "terminal",
		region: '[data-test-panel-notice="deciding"]:has-text("Still choosing articles for")',
	}),
	geometry: NO_GEOMETRY,
	target: "main",
	capture: "element",
	pinnedText: PINNED_DETAIL_RECIPIENT,
};

const articlesDecided: VisualCheckpoint = {
	name: "inbox-articles-decided",
	settled: articlesPanelSettled({
		status: "terminal",
		region: '[data-test-readlist-line="work"]:has-text("1 of 3 also fit Work.")',
	}),
	geometry: NO_GEOMETRY,
	target: "main",
	capture: "element",
	pinnedText: PINNED_DETAIL_RECIPIENT,
};

const articlesDecisionFailed: VisualCheckpoint = {
	name: "inbox-articles-decision-failed",
	settled: articlesPanelSettled({
		status: "terminal",
		region: '[data-test-readlist-line="work"]:has-text("Couldn\'t choose articles for Work.")',
	}),
	geometry: NO_GEOMETRY,
	target: "main",
	capture: "element",
	pinnedText: PINNED_DETAIL_RECIPIENT,
};

const articlesFitMarkers: VisualCheckpoint = {
	name: "inbox-articles-fit-markers",
	settled: async (page) => {
		await articlesPanelSettled({
			status: "terminal",
			region: '[data-test-readlist-line="work"]:has-text("1 of 3 also fit Work.")',
		})(page);
		await expect(page.locator("[data-test-fit-marker-label]")).toHaveText([
			"Fits Work",
			"Not for Work",
			"Not for Work",
		]);
		await expect(page.locator("[data-test-fit-marker-reason]")).toHaveText([
			"Engineering practice",
			"A product announcement, not engineering practice",
		]);
		await expect(page.locator('[data-test-card-action^="fit-"]')).toHaveText([
			"Doesn't fit Work",
			"Keep in Work",
			"Keep in Work",
		]);
	},
	geometry: NO_GEOMETRY,
	target: "[data-test-panel-listing]",
	capture: "element",
	pinnedText: [],
};

const keptCard: VisualCheckpoint = {
	name: "inbox-article-card-kept",
	settled: async (page) => {
		const card = page.locator('[data-test-inbox-article-card="0001"]');
		await expect(card.locator("[data-test-fit-marker-label]")).toHaveText("Kept in Work");
		await expect(card.locator("[data-test-fit-marker-chosen]")).toHaveText(
			"You chose this on Oct 14, 2026.",
		);
		await expect(card.locator("[data-test-fit-marker-reason]")).toHaveCount(0);
		await expect(card.locator('[data-test-card-action="fit-drop"]')).toHaveText("Doesn't fit Work");
	},
	geometry: NO_GEOMETRY,
	target: '[data-test-inbox-article-card="0001"]',
	capture: "element",
	pinnedText: [],
};

const fitKeepToast: VisualCheckpoint = {
	name: "inbox-fit-keep-toast",
	settled: async (page) => {
		const toast = page.locator("[data-test-toast]");
		await expect(toast).toBeVisible();
		await expect(toast.locator("[data-test-toast-message]")).toHaveText("Adding to Work…");
		await expect(toast.locator("[data-test-toast-action]")).toHaveText("Undo");
	},
	geometry: NO_GEOMETRY,
	target: "[data-test-toast]",
	capture: "element",
	pinnedText: [],
};

const failedKeepControls: VisualCheckpoint = {
	name: "inbox-articles-failed-keep-controls",
	settled: async (page) => {
		await articlesPanelSettled({
			status: "terminal",
			region: '[data-test-readlist-line="work"]:has-text("Use Keep in Work on any article you want there.")',
		})(page);
		await expect(page.locator("[data-test-fit-marker]")).toHaveCount(0);
		await expect(page.locator('[data-test-card-action="fit-keep"]')).toHaveText([
			"Keep in Work",
			"Keep in Work",
		]);
		await expect(
			page.locator('[data-test-inbox-article-card="0002"] [data-test-card-action^="fit-"]'),
		).toHaveCount(0);
	},
	geometry: NO_GEOMETRY,
	target: "main",
	capture: "element",
	pinnedText: PINNED_DETAIL_RECIPIENT,
};

const articlesShowFit: VisualCheckpoint = {
	name: "inbox-articles-show-fit",
	settled: async (page) => {
		await articlesPanelSettled({
			status: "terminal",
			region: '[data-test-readlist-filter="fit"][aria-current="true"]',
		})(page);
		await expect(page.locator("[data-test-inbox-article-card]")).toHaveCount(1);
		await expect(page.locator('[data-test-inbox-article-card="0000"]')).toBeVisible();
		await expect(page.locator('[data-test-readlist-filter="rest"]')).not.toHaveAttribute(
			"aria-current",
		);
	},
	geometry: NO_GEOMETRY,
	target: "main",
	capture: "element",
	pinnedText: PINNED_DETAIL_RECIPIENT,
};

async function articleMenuInsideCard(page: Page): Promise<void> {
	const cardBox = await measuredBox(page, FIRST_ARTICLE_CARD);
	const panelBox = await measuredBox(page, `${FIRST_ARTICLE_MENU} .menu__panel`);
	const rowBox = await measuredBox(page, `${FIRST_ARTICLE_MENU} .menu__item`);
	assert.ok(panelBox.x >= cardBox.x && panelBox.x + panelBox.width <= cardBox.x + cardBox.width);
	assert.ok(panelBox.y >= cardBox.y && panelBox.y + panelBox.height <= cardBox.y + cardBox.height);
	assert.ok(panelBox.width >= 120);
	assert.ok(Math.abs(rowBox.height - 44) <= 0.5);
}

const articleMenuOpen: VisualCheckpoint = {
	name: "inbox-article-menu-open",
	settled: async (page) => {
		await expect(page.locator('[data-test-tab-panel="articles"]')).toHaveAttribute(
			"data-articles-status",
			"terminal",
		);
		await snapToWholePixels(page, FIRST_ARTICLE_CARD);
		await page.locator(`${FIRST_ARTICLE_MENU} summary`).click();
		await expect(page.locator(FIRST_ARTICLE_MENU)).toHaveAttribute("open", "");
		await expect(page.locator(`${FIRST_ARTICLE_MENU} .menu__panel`)).toBeVisible();
		await page.mouse.move(0, 0);
	},
	geometry: articleMenuInsideCard,
	target: FIRST_ARTICLE_CARD,
	capture: "element",
	pinnedText: [],
};

async function seedOnePastAPage(page: Page): Promise<void> {
	await page.request.post("/e2e/session");
	await page.request.post("/e2e/seed-address", { data: { name: "e2e" } });
	for (let index = 0; index <= INBOX_EMAILS_PAGE_SIZE; index++) {
		const seeded = await page.request.post("/e2e/seed-email", {
			data: {
				messageId: `<pager-${index}@e2e>`,
				receivedAt: new Date(Date.parse(RECEIVED_AT) - index * 60_000).toISOString(),
				senderEmail: "news@example.com",
				subject: `Weekly digest ${index}`,
			},
		});
		assert.equal(seeded.status(), 200, await seeded.text());
	}
}

async function pagerSitsOnTheTrailingEdge(page: Page): Promise<void> {
	const pager = await measuredBox(page, "[data-test-pagination]");
	const controls = await measuredBox(page, "[data-test-pagination] .pagination__controls");
	assert.ok(
		Math.abs(pager.x + pager.width - (controls.x + controls.width)) <= 0.5,
		`the controls must sit on the pager's trailing edge, measured pager=${JSON.stringify(pager)} controls=${JSON.stringify(controls)}`,
	);
}

function emailsPager(theme: "light" | "dark"): VisualCheckpoint {
	return {
		name: `inbox-emails-pagination-${theme}`,
		settled: async (page) => {
			await expect(page.locator('[data-test-pagination-disabled="newer"]')).toHaveAttribute(
				"aria-disabled",
				"true",
			);
			await expect(page.locator('[data-test-pagination-link="older"]')).toBeVisible();
			await page.mouse.move(0, 0);
		},
		geometry: pagerSitsOnTheTrailingEdge,
		target: "[data-test-pagination]",
		capture: "element",
		pinnedText: [],
	};
}

const NEWSLETTER_SENDER = "news@example.com";
const NEWSLETTER_LINE = "#newsletter-links-line";
const NEWSLETTER_COUNT = "#newsletter-links-count";

const DESKTOP_VIEWPORT = { name: "desktop", viewport: { width: 1280, height: 900 } } as const;
const LAYOUTS = [DESKTOP_VIEWPORT, { name: "mobile", viewport: { width: 390, height: 844 } }] as const;

async function seedNewsletterLinks(
	page: Page,
	seed: { newsletterLink: boolean; held: readonly string[] },
): Promise<void> {
	await seedEmail(page, { links: TWO_CRAWLED_LINKS });
	for (const url of seed.held) {
		const linked = await page.request.post("/e2e/seed-newsletter-link", {
			data: { url, senderEmail: NEWSLETTER_SENDER },
		});
		assert.equal(linked.status(), 200, await linked.text());
		const held = await page.request.post("/e2e/hold-newsletter-link", { data: { url } });
		assert.equal(held.status(), 200, await held.text());
		assert.deepEqual(await held.json(), { outcome: "held" }, `the harness must hold ${url}`);
	}
	if (seed.newsletterLink) {
		const linked = await page.request.post("/e2e/seed-newsletter-link", {
			data: { url: "https://example.com/newsletter-link", senderEmail: NEWSLETTER_SENDER },
		});
		assert.equal(linked.status(), 200, await linked.text());
	}
}

type NewsletterLinksCountState = "counting" | "counted" | "failed";
type NewsletterLinksLineState = "offer" | "working" | "result" | "failed";
type SenderCount = { senderEmail: string; count: number };

interface NewsletterLinksJobFinish {
	selected?: number;
	state?: "completed" | "failed";
	counts?: Record<string, number>;
	issues?: number;
	held?: { bySender: SenderCount[]; unrestorable: string[] };
	skipped?: { read: number; opened: number; highlighted: number; changed: number; unreadable: number };
	savedBeforeMarker?: number;
	extraSenders?: SenderCount[];
}

async function finishNewsletterLinksJob(page: Page, job: NewsletterLinksJobFinish): Promise<void> {
	const finished = await page.request.post("/e2e/finish-saved-links-job", {
		data: { selected: 3, senderEmail: NEWSLETTER_SENDER, ...job },
	});
	assert.equal(finished.status(), 200, await finished.text());
}

async function openNewsletterLinksPage(page: Page, button: "remove" | "restore"): Promise<void> {
	await page.goto("/inbox");
	await page.locator(`${NEWSLETTER_LINE} [data-test-newsletter-links-${button}]`).click();
	await expect(page.locator(NEWSLETTER_COUNT)).toHaveAttribute("data-newsletter-links-count", "counting");
}

async function reloadUntilCount(page: Page, state: NewsletterLinksCountState): Promise<void> {
	await page.reload();
	await expect(page.locator(NEWSLETTER_COUNT)).toHaveAttribute("data-newsletter-links-count", state);
}

async function reloadUntilLine(page: Page, state: NewsletterLinksLineState): Promise<void> {
	await page.goto("/inbox");
	await expect(page.locator(NEWSLETTER_LINE)).toHaveAttribute("data-newsletter-links-state", state);
}

async function useLayout(
	page: Page,
	layout: { viewport: { width: number; height: number } },
	theme: "light" | "dark",
): Promise<void> {
	await page.setViewportSize(layout.viewport);
	await page.emulateMedia({ colorScheme: theme });
}

async function pageFitsTheViewport(page: Page): Promise<void> {
	const html = page.locator("html");
	const overflow = await html.evaluate((root) => ({ scrollWidth: root.scrollWidth, clientWidth: root.clientWidth }));
	assert.ok(
		overflow.scrollWidth <= overflow.clientWidth,
		`the page must not scroll sideways, measured ${JSON.stringify(overflow)}`,
	);
}

async function lineSitsOneGapFromItsNeighbours(page: Page): Promise<void> {
	const header = await measuredBox(page, ".inbox-emails__header");
	const line = await measuredBox(page, NEWSLETTER_LINE);
	const listing = await measuredBox(page, "[data-test-inbox-emails-listing]");
	assert.ok(
		Math.abs(line.y - (header.y + header.height) - 16) <= 0.5,
		`the line must sit 16px below the header, measured header=${JSON.stringify(header)} line=${JSON.stringify(line)}`,
	);
	assert.ok(
		Math.abs(listing.y - (line.y + line.height) - 16) <= 0.5,
		`the listing must sit 16px below the line, measured line=${JSON.stringify(line)} listing=${JSON.stringify(listing)}`,
	);
}

function newsletterLinksLine(name: string, state: NewsletterLinksLineState): VisualCheckpoint {
	return {
		name: `inbox-newsletter-links-${name}`,
		settled: async (page) => {
			await expect(page.locator(NEWSLETTER_LINE)).toHaveAttribute("data-newsletter-links-state", state);
		},
		geometry: NO_GEOMETRY,
		target: NEWSLETTER_LINE,
		capture: "element",
		pinnedText: [],
	};
}

function newsletterLinksPage(
	name: string,
	settled: (page: Page) => Promise<void>,
	geometry: (page: Page) => Promise<void>,
): VisualCheckpoint {
	return {
		name: `inbox-newsletter-links-${name}`,
		settled,
		geometry,
		target: "main",
		capture: "element",
		pinnedText: [],
	};
}

const countState = (state: NewsletterLinksCountState) => async (page: Page) => {
	await expect(page.locator(NEWSLETTER_COUNT)).toHaveAttribute("data-newsletter-links-count", state);
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
		await page.goto("/newsletters/custom-emails");
		await captureCheckpoint(page, addressesPage);
	});

	test("captures the created address toast", async ({ page }) => {
		await page.request.post("/e2e/session");
		await page.request.post("/e2e/seed-address", { data: { name: "e2e" } });
		await page.route("**/client-dist/toast.client.js", (route) => route.abort());
		await page.goto("/newsletters/custom-emails?created=e2e");
		await captureCheckpoint(page, createdToast);
	});

	test("captures an inbox address limit alert", async ({ page }) => {
		await page.request.post("/e2e/session");
		await page.goto("/newsletters/custom-emails?error=limit");
		await captureCheckpoint(page, addressAlert);
	});

	test("captures an unavailable email alert", async ({ page }) => {
		await page.request.post("/e2e/session");
		await page.request.post("/e2e/seed-address", { data: { name: "e2e" } });
		const seeded = await page.request.post("/e2e/seed-email", {
			data: {
				messageId: "<unparsed-visual@e2e>",
				receivedAt: RECEIVED_AT,
				senderEmail: "news@example.com",
				subject: "Weekly digest",
				status: "unparsed",
			},
		});
		assert.equal(seeded.status(), 200, await seeded.text());
		const { emailId } = (await seeded.json()) as { emailId: string };
		await page.goto(`/inbox/${encodeURIComponent(emailId)}`);
		await captureCheckpoint(page, emailDetailAlert);
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
			selectedReadlists: [{ readlist: WORK_READLIST, label: "Work" }],
			eligibleArticleCount: 2,
			savesHeld: false,
		});
		const releasePoll = await holdPanelPollThenSpendBudget(page);
		await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=articles`);
		await captureCheckpoint(page, articlesDeciding);
		releasePoll();
		await captureCheckpoint(page, articlesDecisionStale);
	});

	test("captures the Articles tab once its readlist decided", async ({ page }) => {
		const emailId = await seedEmail(page, {
			links: ROUTED_LINKS,
			selectedReadlists: [{ readlist: WORK_READLIST, label: "Work" }],
			eligibleArticleCount: 3,
			savesHeld: false,
			readlistOutcomes: [
				{
					readlist: WORK_READLIST,
					readlistLabel: "Work",
					decision: "filtered",
					fit: [
						{ ordinal: "0000", verdict: "keep", reason: "Engineering practice" },
						{ ordinal: "0001", verdict: "drop", reason: "A product announcement, not engineering practice" },
						{ ordinal: "0002", verdict: "drop", reason: "" },
					],
				},
			],
		});
		await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=articles`);
		await captureCheckpoint(page, articlesDecided);
	});

	test("captures each article's readlist call, with a reason under the engine's keep and drop", async ({
		page,
	}) => {
		const emailId = await seedEmail(page, {
			links: ROUTED_LINKS,
			selectedReadlists: [{ readlist: WORK_READLIST, label: "Work" }],
			eligibleArticleCount: 3,
			savesHeld: false,
			readlistOutcomes: [WORK_FIT_WITH_UNSURE],
		});
		await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=articles`);
		await captureCheckpoint(page, articlesFitMarkers);
	});

	test("captures a card the reader kept in a readlist, with the day they chose it", async ({ page }) => {
		const emailId = await seedEmail(page, {
			links: ROUTED_LINKS,
			selectedReadlists: [{ readlist: WORK_READLIST, label: "Work" }],
			eligibleArticleCount: 3,
			savesHeld: false,
			readlistOutcomes: [WORK_FIT_WITH_UNSURE],
			fitOverrides: [
				{
					readlist: WORK_READLIST,
					ordinal: "0001",
					readerVerdict: "keep",
					createdAt: "2026-10-14T09:00:00.000Z",
				},
			],
		});
		await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=articles`);
		await captureCheckpoint(page, keptCard);
	});

	test("captures the toast after Keep in Work, with its Undo", async ({ page }) => {
		const emailId = await seedEmail(page, {
			links: ROUTED_LINKS,
			selectedReadlists: [{ readlist: WORK_READLIST, label: "Work" }],
			eligibleArticleCount: 3,
			savesHeld: false,
			readlistOutcomes: [WORK_FIT_WITH_UNSURE],
			fitOverrides: [
				{
					readlist: WORK_READLIST,
					ordinal: "0001",
					readerVerdict: "keep",
					createdAt: "2026-10-14T09:00:00.000Z",
				},
			],
		});
		await page.goto(
			`/inbox/${encodeURIComponent(emailId)}?tab=articles&fit=keep&in=${WORK_READLIST}&link=0001`,
		);
		await captureCheckpoint(page, fitKeepToast);
	});

	test("captures a failed readlist call offering Keep in Work on every saveable card", async ({
		page,
	}) => {
		const emailId = await seedEmail(page, {
			links: [
				...TWO_CRAWLED_LINKS,
				{ url: "http://localhost/intranet-note", status: "crawled", title: "An intranet note" },
			],
			selectedReadlists: [{ readlist: WORK_READLIST, label: "Work" }],
			eligibleArticleCount: 3,
			savesHeld: false,
			readlistOutcomes: [
				{ readlist: WORK_READLIST, readlistLabel: "Work", decision: "failed", fit: [] },
			],
		});
		await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=articles`);
		await captureCheckpoint(page, failedKeepControls);
	});

	test("captures the Articles tab showing only the articles that fit a readlist", async ({ page }) => {
		const emailId = await seedEmail(page, {
			links: ROUTED_LINKS,
			selectedReadlists: [{ readlist: WORK_READLIST, label: "Work" }],
			eligibleArticleCount: 3,
			savesHeld: false,
			readlistOutcomes: [WORK_FIT_WITH_UNSURE],
		});
		await page.goto(
			`/inbox/${encodeURIComponent(emailId)}?tab=articles&readlist=${WORK_READLIST}&show=fit`,
		);
		await captureCheckpoint(page, articlesShowFit);
	});

	test("captures the Articles tab when its readlist could not decide", async ({ page }) => {
		const emailId = await seedEmail(page, {
			links: TWO_CRAWLED_LINKS,
			selectedReadlists: [{ readlist: WORK_READLIST, label: "Work" }],
			eligibleArticleCount: 2,
			savesHeld: false,
			readlistOutcomes: [
				{ readlist: WORK_READLIST, readlistLabel: "Work", decision: "failed", fit: [] },
			],
		});
		await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=articles`);
		await captureCheckpoint(page, articlesDecisionFailed);
	});

	test("captures independent Gmail readlist results while All keeps every article", async ({ page }) => {
		const emailId = await seedEmail(page, {
			links: TWO_CRAWLED_LINKS,
			eligibleArticleCount: 2,
			savesHeld: false,
			selectedReadlists: [
				{ readlist: WORK_READLIST, label: "Work" },
				{ readlist: "science", label: "Science" },
				{ readlist: "weekend", label: "Weekend reading" },
			],
			readlistOutcomes: [
				{
					readlist: WORK_READLIST,
					readlistLabel: "Work",
					decision: "filtered",
					fit: [
						{ ordinal: "0000", verdict: "keep", reason: "Engineering practice" },
						{ ordinal: "0001", verdict: "drop", reason: "Outside engineering practice" },
					],
				},
				{
					readlist: "science",
					readlistLabel: "Science",
					decision: "failed",
					fit: [],
				},
			],
		});
		await page.route("**/articles?poll=*", (route) => route.abort());
		for (const width of [
			{ name: "desktop", viewport: { width: 1280, height: 900 } },
			{ name: "mobile", viewport: { width: 390, height: 844 } },
		]) {
			await page.setViewportSize(width.viewport);
			for (const theme of ["light", "dark"] as const) {
				await page.emulateMedia({ colorScheme: theme });
				await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=articles`);
				await captureCheckpoint(page, {
					name: `inbox-gmail-readlist-results-${width.name}-${theme}`,
					settled: async (settling) => {
						await expect(settling.locator('[data-test-tab-panel="articles"]')).toHaveAttribute(
							"data-articles-status",
							"terminal",
						);
						await expect(settling.locator('[data-test-tab-panel="articles"]')).toHaveAttribute(
							"hx-get",
							/\/articles\?poll=1$/,
						);
						await expect(settling.locator("[data-test-panel-notice]")).toHaveText([
							"Saved to All.",
							"Choosing articles for Weekend reading…",
						]);
						await expect(settling.locator("[data-test-readlist-line] span")).toHaveText([
							"1 of 2 also fit Work.",
							"Couldn't choose articles for Science. Its links were saved to All. Use Keep in Science on any article you want there.",
						]);
						await expect(settling.locator("[data-test-inbox-article-card]")).toHaveCount(2);
					},
					geometry: async (settling) => {
						const main = await measuredBox(settling, "main");
						const viewport = settling.viewportSize();
						assert.ok(viewport, "the visual checkpoint must have a fixed viewport");
						assert.ok(
							main.x >= 0 && main.x + main.width <= viewport.width,
							"the filtering results must fit inside the viewport",
						);
					},
					target: "main",
					capture: "element",
					pinnedText: PINNED_DETAIL_RECIPIENT,
				});
			}
		}
	});

	test("captures an open article menu inside its card", async ({ page }) => {
		const emailId = await seedEmail(page, { links: TWO_CRAWLED_LINKS });
		await page.goto(`/inbox/${encodeURIComponent(emailId)}?tab=articles`);
		await captureCheckpoint(page, articleMenuOpen);
	});

	test("captures the email list pager", async ({ page }) => {
		await seedOnePastAPage(page);
		for (const theme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto("/inbox");
			await captureCheckpoint(page, emailsPager(theme));
		}
	});

	test("captures the newsletter-links line offering Remove and Restore between the header and the listing", async ({
		page,
	}) => {
		await seedNewsletterLinks(page, {
			newsletterLink: true,
			held: ["https://example.com/held-1", "https://example.com/held-2"],
		});
		for (const layout of LAYOUTS) {
			for (const theme of ["light", "dark"] as const) {
				await useLayout(page, layout, theme);
				await page.goto("/inbox");
				await captureCheckpoint(page, {
					name: `inbox-newsletter-links-offer-${layout.name}-${theme}`,
					settled: async (settling) => {
						const line = settling.locator(NEWSLETTER_LINE);
						await expect(line).toHaveAttribute("data-newsletter-links-state", "offer");
						await expect(line.locator("[data-test-newsletter-links-remove]")).toBeVisible();
						await expect(line.locator("[data-test-newsletter-links-restore]")).toBeVisible();
					},
					geometry: lineSitsOneGapFromItsNeighbours,
					target: "main",
					capture: "element",
					pinnedText: PINNED_LIST_RECIPIENT,
				});
			}
		}
	});

	test("captures the remove page while counting and once counted, then the line removing and its result", async ({
		page,
	}) => {
		await seedNewsletterLinks(page, { newsletterLink: true, held: [] });
		await useLayout(page, DESKTOP_VIEWPORT, "light");
		await openNewsletterLinksPage(page, "remove");
		await page.route("**/inbox/newsletter-links/remove", (route) => route.abort());
		await captureCheckpoint(
			page,
			newsletterLinksPage("remove-counting", countState("counting"), pageFitsTheViewport),
		);
		await page.unroute("**/inbox/newsletter-links/remove");

		await finishNewsletterLinksJob(page, {
			selected: 15,
			issues: 4,
			skipped: { read: 2, opened: 1, highlighted: 1, changed: 1, unreadable: 1 },
			savedBeforeMarker: 2,
			extraSenders: [{ senderEmail: "digest@another-newsletter.example", count: 12 }],
		});
		await reloadUntilCount(page, "counted");
		for (const layout of LAYOUTS) {
			for (const theme of ["light", "dark"] as const) {
				await useLayout(page, layout, theme);
				await captureCheckpoint(
					page,
					newsletterLinksPage(
						`remove-counted-${layout.name}-${theme}`,
						async (settling) => {
							await countState("counted")(settling);
							await expect(settling.locator("[data-test-newsletter-links-skipped-reason]")).toHaveCount(5);
							await expect(settling.locator("[data-test-newsletter-links-before-marker]")).toHaveCount(1);
							await expect(settling.locator("[data-test-newsletter-links-sender]")).toHaveCount(2);
						},
						pageFitsTheViewport,
					),
				);
			}
		}

		await useLayout(page, DESKTOP_VIEWPORT, "light");
		await page.locator("[data-test-newsletter-links-submit]").click();
		await expect(page.locator(NEWSLETTER_LINE)).toHaveAttribute("data-newsletter-links-state", "working");
		await page.route("**/inbox", (route) => route.abort());
		await captureCheckpoint(page, newsletterLinksLine("working", "working"));
		await page.unroute("**/inbox");

		await finishNewsletterLinksJob(page, { counts: { held: 3, read: 2, opened: 1, unreadable: 1 } });
		await reloadUntilLine(page, "result");
		await captureCheckpoint(page, newsletterLinksLine("result", "result"));
	});

	test("captures the remove page with nothing to remove, then a count that failed", async ({ page }) => {
		await seedNewsletterLinks(page, { newsletterLink: true, held: [] });
		await useLayout(page, DESKTOP_VIEWPORT, "light");
		await openNewsletterLinksPage(page, "remove");
		await finishNewsletterLinksJob(page, { selected: 0 });
		await reloadUntilCount(page, "counted");
		await captureCheckpoint(
			page,
			newsletterLinksPage(
				"remove-nothing",
				async (settling) => {
					await countState("counted")(settling);
					await expect(settling.locator("[data-test-newsletter-links-remove-form]")).toHaveCount(0);
				},
				pageFitsTheViewport,
			),
		);

		await openNewsletterLinksPage(page, "remove");
		await finishNewsletterLinksJob(page, { state: "failed" });
		await reloadUntilCount(page, "failed");
		await captureCheckpoint(
			page,
			newsletterLinksPage("count-failed", countState("failed"), pageFitsTheViewport),
		);
	});

	test("captures the line after a removal failed", async ({ page }) => {
		await seedNewsletterLinks(page, { newsletterLink: true, held: [] });
		await useLayout(page, DESKTOP_VIEWPORT, "light");
		await openNewsletterLinksPage(page, "remove");
		await finishNewsletterLinksJob(page, {});
		await reloadUntilCount(page, "counted");
		await page.locator("[data-test-newsletter-links-submit]").click();
		await expect(page.locator(NEWSLETTER_LINE)).toHaveAttribute("data-newsletter-links-state", "working");
		await finishNewsletterLinksJob(page, { state: "failed" });
		for (const theme of ["light", "dark"] as const) {
			await useLayout(page, DESKTOP_VIEWPORT, theme);
			await reloadUntilLine(page, "failed");
			await captureCheckpoint(page, newsletterLinksLine(`failed-${theme}`, "failed"));
		}
	});

	test("captures the restore page listing links it cannot restore, without sideways scroll down to 320px", async ({
		page,
	}) => {
		await seedNewsletterLinks(page, {
			newsletterLink: false,
			held: ["https://example.com/held-1", "https://example.com/held-2"],
		});
		await useLayout(page, DESKTOP_VIEWPORT, "light");
		await openNewsletterLinksPage(page, "restore");
		await finishNewsletterLinksJob(page, {
			held: {
				bySender: [
					{ senderEmail: NEWSLETTER_SENDER, count: 2 },
					{ senderEmail: "digest@another-newsletter.example", count: 5 },
				],
				unrestorable: [
					"https://example.com/gone-article",
					"https://another.example/a/very/long/path/that/should/wrap/somewhere-on-a-narrow-phone-screen",
				],
			},
		});
		await reloadUntilCount(page, "counted");
		for (const layout of LAYOUTS) {
			for (const theme of ["light", "dark"] as const) {
				await useLayout(page, layout, theme);
				await captureCheckpoint(
					page,
					newsletterLinksPage(
						`restore-counted-${layout.name}-${theme}`,
						async (settling) => {
							await countState("counted")(settling);
							await expect(settling.locator("[data-test-newsletter-links-unrestorable]")).toBeVisible();
							await expect(settling.locator(".newsletter-links-page__unrestorable-list li")).toHaveCount(2);
						},
						pageFitsTheViewport,
					),
				);
			}
		}
		await page.setViewportSize({ width: 320, height: 844 });
		await pageFitsTheViewport(page);
	});
});
