import assert from "node:assert/strict";
import type { CDPSession, Page } from "@playwright/test";
import { z } from "zod";
import { expect, test } from "@packages/e2e-harness";
import { type InteractionInk, collectInteractionInk, countUnfinishedAnimations } from "./interaction-ink.browser";
import { createReadlistFromReader } from "./page-interactions";
import { type PlaceholderInk, collectPlaceholderInk } from "./placeholder-ink.browser";
import { LENSES, NON_TEXT_MINIMUM, type Rgb, contrastRatio, textMinimum } from "./wcag-contrast";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://localhost:${E2E_PORT}`;
const VIEWPORT = { width: 1280, height: 900 };
const SETTLE_MS = 30000;
const PASSWORD = "password123";
const THEMES = ["light", "dark"] as const;
const FOCUSED = ["focus", "focus-visible"];
const LOGIN_EMAIL_FIELD = '[data-test-form="login"] input.form-input[name="email"]';
const SAVE_FIELD = '[data-test-form="save-article"] input.form-input[name="url"]';
const FROM_URL_FIELD = '[data-test-form="import-from-url"] input.form-input[name="url"]';
const SEARCH_FIELD = "#readlist-search-input";
const REVIEW_URLS = [
	"https://example.com/essays/focus-ring-first",
	"https://example.com/essays/focus-ring-second",
	"https://example.com/essays/focus-ring-third",
];
const REVIEW_CHECKBOX_BEFORE = '[data-test-import-checkbox="0"]';
const REVIEW_CHECKBOX = '[data-test-import-checkbox="1"]';
const GMAIL_CHECKLIST_CHECKBOX_BEFORE = '[data-test-gmail-checklist-sender="crew@morningbrew.com"]';
const GMAIL_CHECKLIST_CHECKBOX = '[data-test-gmail-checklist-sender="dan@tldr.tech"]';
const HISTORY_CARD = "[data-test-article-history]";
const HISTORY_HEADER = `${HISTORY_CARD} > summary`;
const HISTORY_TITLE = `${HISTORY_HEADER} .disclosure-card__title`;
const HISTORY_DELETE = `${HISTORY_CARD} [data-test-action="article-version-delete-open"]`;
const TOC_CARD = "[data-test-toc-card]";
const TOC_CURRENT_ROW = `${TOC_CARD} [data-test-toc-section][aria-current="location"]`;
const TOC_OTHER_ROW = `${TOC_CARD} [data-test-toc-section]:not([aria-current])`;
const TOOLBAR_CONTROLS = [
	{ selector: "summary[data-test-readlists-trigger]", auditId: "toolbar-add", ink: "label" },
	{ selector: '[data-test-mark-read-slot] [data-test-action="mark-read"]', auditId: "toolbar-mark", ink: "label" },
	{ selector: '[data-test-action="share-open"]', auditId: "toolbar-share", ink: "glyph" },
] as const;

type Lens = (colour: Rgb) => Rgb;
type Ring = InteractionInk["outline"];

interface AuditedField {
	path: string;
	selector: string;
	view: string;
}

interface Neighbour {
	name: string;
	colour: Rgb;
}

async function auditContext(page: Page): Promise<CDPSession> {
	const client = await page.context().newCDPSession(page);
	await client.send("DOM.enable");
	await client.send("CSS.enable");
	return client;
}

async function stamp(page: Page, target: { selector: string; auditId: string }): Promise<void> {
	await page
		.locator(target.selector)
		.first()
		.evaluate((element, id) => element.setAttribute("data-audit-id", id), target.auditId);
}

async function measure(
	page: Page,
	client: CDPSession,
	auditId: string,
	pseudo: string[],
): Promise<InteractionInk> {
	const document = await client.send("DOM.getDocument", { depth: -1 });
	const target = await client.send("DOM.querySelector", {
		nodeId: document.root.nodeId,
		selector: `[data-audit-id="${auditId}"]`,
	});
	assert.ok(target.nodeId > 0, `no node carries [data-audit-id="${auditId}"] for forcePseudoState`);
	await client.send("CSS.forcePseudoState", {
		nodeId: target.nodeId,
		forcedPseudoClasses: pseudo,
	});
	await expect
		.poll(() => page.evaluate(countUnfinishedAnimations, auditId), { timeout: SETTLE_MS })
		.toBe(0);
	return page.evaluate(collectInteractionInk, auditId);
}

function boundaryContrast(ink: InteractionInk, lens: Lens): number {
	const surface = lens(ink.surface);
	const candidates = [contrastRatio({ ink: lens(ink.fill), surface })];
	for (const colour of ink.visibleBoundaryColours) {
		candidates.push(contrastRatio({ ink: lens(colour), surface }));
	}
	return Math.max(...candidates);
}

function insetShadowContrast(ink: InteractionInk, lens: Lens): number {
	assert.match(ink.boxShadow, /inset/);
	const edge = ink.boxShadow.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
	assert(edge, `${ink.name} must paint an opaque inset shadow`);
	return contrastRatio({
		ink: lens({ red: Number(edge[1]), green: Number(edge[2]), blue: Number(edge[3]) }),
		surface: lens(ink.surface),
	});
}

function labelContrast(ink: InteractionInk, lens: Lens): number {
	return contrastRatio({ ink: lens(ink.text), surface: lens(ink.fill) });
}

function boundaryShortfall(ink: InteractionInk, lens: Lens, view: string): string {
	return `${view}: ${ink.name} boundary ${boundaryContrast(ink, lens).toFixed(2)}:1 < ${NON_TEXT_MINIMUM}:1`;
}

function labelShortfall(ink: InteractionInk, lens: Lens, view: string): string {
	return `${view}: ${ink.name} label ${labelContrast(ink, lens).toFixed(2)}:1 < ${textMinimum(ink)}:1`;
}

function selectedInkShortfall(input: { rest: InteractionInk; hover: InteractionInk; view: string }): string {
	const { rest, hover, view } = input;
	return `${view}: ${hover.name} lost its selected ink on hover — rest rgb(${rest.text.red},${rest.text.green},${rest.text.blue}) vs hover rgb(${hover.text.red},${hover.text.green},${hover.text.blue})`;
}

function ringShortfall(input: { field: Ring; button: Ring; view: string }): string {
	const { field, button, view } = input;
	return `${view}: field ring ${JSON.stringify(field)} does not match its button ring ${JSON.stringify(button)}`;
}

function ringEdges(ink: InteractionInk): Rgb[] {
	return ink.borders
		.filter((edge) => edge.width > 0 && edge.style !== "none")
		.map((edge) => edge.colour);
}

function edgeContrast(input: { edge: Rgb; against: Neighbour; lens: Lens }): number {
	return contrastRatio({ ink: input.lens(input.edge), surface: input.lens(input.against.colour) });
}

function edgeShortfall(input: { edge: Rgb; against: Neighbour; lens: Lens; view: string }): string {
	const { edge, against, view } = input;
	return `${view}: focus edge rgb(${edge.red},${edge.green},${edge.blue}) is ${edgeContrast(input).toFixed(2)}:1 against the ${against.name} < ${NON_TEXT_MINIMUM}:1`;
}

function underlineEdge(ink: InteractionInk): InteractionInk["borders"][number] {
	const [, , bottom] = ink.borders;
	assert.equal(bottom.style, "solid", `${ink.name} must draw its underline as a solid bottom border`);
	assert.equal(bottom.width, 2, `${ink.name} must draw a 2px underline`);
	return bottom;
}

function underlineShortfall(input: { ink: InteractionInk; lens: Lens; view: string }): string {
	const { ink, lens, view } = input;
	const edge = underlineEdge(ink).colour;
	const contrast = contrastRatio({ ink: lens(edge), surface: lens(ink.surface) });
	return `${view}: ${ink.name} underline rgb(${edge.red},${edge.green},${edge.blue}) is ${contrast.toFixed(2)}:1 against the canvas < ${NON_TEXT_MINIMUM}:1`;
}

function placeholderContrast(ink: PlaceholderInk, lens: Lens): number {
	return contrastRatio({ ink: lens(ink.placeholder), surface: lens(ink.fill) });
}

function placeholderShortfall(ink: PlaceholderInk, lens: Lens, view: string): string {
	return `${view}: ${ink.name} placeholder ${placeholderContrast(ink, lens).toFixed(2)}:1 < ${textMinimum(ink)}:1`;
}

async function signInAsNewReader(page: Page, email: string): Promise<string> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	const userId = z.object({ userId: z.string() }).parse(await created.json()).userId;
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
	return userId;
}

async function auditCheckboxFocusRing(page: Page, input: { before: string; checkbox: string; auditId: string; view: string }): Promise<void> {
	await page.locator(input.before).focus();
	await page.keyboard.press("Tab");
	const checkbox = page.locator(input.checkbox);
	await expect(checkbox).toBeFocused();
	await expect.poll(() => checkbox.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
	const client = await auditContext(page);
	await stamp(page, { selector: input.checkbox, auditId: input.auditId });

	for (const theme of THEMES) {
		await page.emulateMedia({ colorScheme: theme });
		const ink = await measure(page, client, input.auditId, []);
		assert.notEqual(ink.outline.style, "none", `${theme}/${input.view}: ${ink.name} draws no focus outline`);
		assert.ok(ink.outline.width > 0, `${theme}/${input.view}: ${ink.name} draws a zero-width focus outline`);
		const row: Neighbour = { name: "row", colour: ink.surface };
		for (const [lensName, lens] of Object.entries(LENSES)) {
			assert.ok(
				edgeContrast({ edge: ink.outline.colour, against: row, lens }) >= NON_TEXT_MINIMUM,
				edgeShortfall({
					edge: ink.outline.colour,
					against: row,
					lens,
					view: `${theme}/${input.view}/${lensName}`,
				}),
			);
		}
	}
}

async function seedGmailChecklist(page: Page, input: { userId: string; namespace: string }): Promise<void> {
	await page.context().addCookies([{ name: "e2e_catalog_ns", value: input.namespace, url: BASE_URL }]);
	const catalog = await page.request.post(`${BASE_URL}/e2e/seed-newsletter-catalog`, {
		data: {
			namespace: input.namespace,
			mode: "available",
			records: [
				{ from: "dan@tldr.tech", name: "TLDR", status: "approved", evidence: [], createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
				{ from: "crew@morningbrew.com", name: "Morning Brew", status: "approved", evidence: [], createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
			],
		},
	});
	assert.equal(catalog.status(), 201, "the newsletter catalog namespace must be seeded");
	const gmail = await page.request.post(`${BASE_URL}/e2e/seed-gmail-state`, {
		data: {
			userId: input.userId,
			discoveredSenders: [
				{ email: "dan@tldr.tech", name: "TLDR" },
				{ email: "crew@morningbrew.com", name: "Morning Brew" },
			],
		},
	});
	assert.equal(gmail.status(), 201, `the gmail state must be seeded: ${await gmail.text()}`);
}

async function seedQueuedArticle(page: Page, input: { userId: string; stampId: string }): Promise<void> {
	const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
		data: {
			url: `https://example.com/search-field-contrast-${input.stampId}`,
			title: "An article the search field can narrow to",
			content: "<p>Seeded body for the search field contrast check.</p>",
			contentFetchedAt: "2026-07-10T09:14:00.000Z",
			savedByUserId: input.userId,
		},
	});
	assert.equal(seeded.status(), 201, "the seed endpoint must create the article");
}

async function openImportReview(page: Page, urls: readonly string[]): Promise<void> {
	await page.goto(`${BASE_URL}/import?mode=upload`, { waitUntil: "domcontentloaded" });
	await page.locator("[data-test-import-file-input]").setInputFiles({
		name: "links.txt",
		mimeType: "text/plain",
		buffer: Buffer.from(urls.join("\n"), "utf-8"),
	});
	await page.waitForSelector("[data-test-import-list]");
}

async function auditFocusRing(page: Page, field: AuditedField): Promise<void> {
	for (const theme of THEMES) {
		await page.emulateMedia({ colorScheme: theme });
		await page.goto(`${BASE_URL}${field.path}`, { waitUntil: "domcontentloaded" });
		const client = await auditContext(page);
		await stamp(page, { selector: field.selector, auditId: "focused-field" });

		const ink = await measure(page, client, "focused-field", FOCUSED);
		const edges = ringEdges(ink);
		assert.ok(edges.length > 0, `${theme}/${field.view}: ${ink.name} draws no border to carry its focus ring`);
		const neighbours: Neighbour[] = [
			{ name: "field fill", colour: ink.fill },
			{ name: "surrounding surface", colour: ink.surface },
		];
		for (const [lensName, lens] of Object.entries(LENSES)) {
			for (const edge of edges) {
				for (const against of neighbours) {
					assert.ok(
						edgeContrast({ edge, against, lens }) >= NON_TEXT_MINIMUM,
						edgeShortfall({ edge, against, lens, view: `${theme}/${field.view}/${lensName}` }),
					);
				}
			}
		}
	}
}

async function auditPlaceholder(page: Page, field: AuditedField): Promise<void> {
	for (const theme of THEMES) {
		await page.emulateMedia({ colorScheme: theme });
		await page.goto(`${BASE_URL}${field.path}`, { waitUntil: "domcontentloaded" });
		await stamp(page, { selector: field.selector, auditId: "placeholder-field" });

		const ink = await page.evaluate(collectPlaceholderInk, "placeholder-field");
		assert.notEqual(ink.placeholderText, "", `${theme}/${field.view}: ${ink.name} shows no placeholder to measure`);
		assert.notDeepEqual(
			ink.placeholder,
			ink.text,
			`${theme}/${field.view}: ${ink.name} ::placeholder resolved to the typed-text ink, so the placeholder itself was not measured`,
		);
		for (const [lensName, lens] of Object.entries(LENSES)) {
			assert.ok(
				placeholderContrast(ink, lens) >= textMinimum(ink),
				placeholderShortfall(ink, lens, `${theme}/${field.view}/${lensName}`),
			);
		}
	}
}

test.describe("Light-pinned interaction states hold their WCAG contrast", () => {
	test.use({ viewport: VIEWPORT });

	test("the Google sign-in button keeps a visible boundary and legible label on hover and active", async ({
		page,
	}) => {
		await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
		const client = await auditContext(page);
		await stamp(page, { selector: '[data-test-auth-provider="google"]', auditId: "google" });

		for (const state of ["hover", "active"]) {
			const ink = await measure(page, client, "google", [state]);
			for (const lens of Object.values(LENSES)) {
				assert.ok(
					boundaryContrast(ink, lens) >= NON_TEXT_MINIMUM,
					boundaryShortfall(ink, lens, `login/google:${state}`),
				);
				assert.ok(
					labelContrast(ink, lens) >= textMinimum(ink),
					labelShortfall(ink, lens, `login/google:${state}`),
				);
			}
		}
	});

	test("the selected install tab keeps its ink under hover", async ({ page }) => {
		await page.goto(`${BASE_URL}/install?client=chrome`, { waitUntil: "domcontentloaded" });
		const client = await auditContext(page);
		await stamp(page, { selector: '[data-test-tab="chrome"][aria-current="page"]', auditId: "install-tab" });

		const rest = await measure(page, client, "install-tab", []);
		const hover = await measure(page, client, "install-tab", ["hover"]);
		for (const lens of Object.values(LENSES)) {
			assert.deepEqual(
				lens(hover.text),
				lens(rest.text),
				selectedInkShortfall({ rest, hover, view: "install/chrome-tab" }),
			);
			assert.ok(
				labelContrast(rest, lens) >= textMinimum(rest),
				labelShortfall(rest, lens, "install/chrome-tab"),
			);
		}
	});

	test("the selected import tab keeps its ink under hover", async ({ page }) => {
		await page.goto(`${BASE_URL}/import`, { waitUntil: "domcontentloaded" });
		const client = await auditContext(page);
		await stamp(page, { selector: '[data-test-import-tab="from-url"][aria-current="page"]', auditId: "import-tab" });

		const rest = await measure(page, client, "import-tab", []);
		const hover = await measure(page, client, "import-tab", ["hover"]);
		for (const lens of Object.values(LENSES)) {
			assert.deepEqual(
				lens(hover.text),
				lens(rest.text),
				selectedInkShortfall({ rest, hover, view: "import/from-url-tab" }),
			);
			assert.ok(
				labelContrast(rest, lens) >= textMinimum(rest),
				labelShortfall(rest, lens, "import/from-url-tab"),
			);
		}
	});

	test("an inactive import tab previews its underline on hover", async ({ page }) => {
		await page.goto(`${BASE_URL}/import`, { waitUntil: "domcontentloaded" });
		const client = await auditContext(page);
		await stamp(page, { selector: '[data-test-import-tab="upload"]', auditId: "import-inactive-tab" });

		const hover = await measure(page, client, "import-inactive-tab", ["hover"]);
		const underline = underlineEdge(hover).colour;
		for (const [lensName, lens] of Object.entries(LENSES)) {
			assert.ok(
				contrastRatio({ ink: lens(underline), surface: lens(hover.surface) }) >= NON_TEXT_MINIMUM,
				underlineShortfall({ ink: hover, lens, view: `import/upload-tab:hover/${lensName}` }),
			);
		}
	});

	test("the import upload error reads in body ink, not the surface red", async ({ page }) => {
		await page.goto(`${BASE_URL}/import?mode=upload&error_code=import_too_large`, {
			waitUntil: "domcontentloaded",
		});
		const client = await auditContext(page);
		await stamp(page, { selector: '[data-test-alert="import"] [data-test-alert-message]', auditId: "import-error" });

		const ink = await measure(page, client, "import-error", []);
		for (const lens of Object.values(LENSES)) {
			assert.ok(
				labelContrast(ink, lens) >= textMinimum(ink),
				labelShortfall(ink, lens, "import/upload-error"),
			);
		}
	});

	test("the pdf-ocr hero field paints the same focus ring as its button", async ({ page }) => {
		await page.goto(`${BASE_URL}/pdf-ocr`, { waitUntil: "domcontentloaded" });
		const client = await auditContext(page);
		await stamp(page, { selector: "#lp-field-try-pdf", auditId: "hero-field" });
		await stamp(page, { selector: '[data-test-section="lp-hero"] [data-test-cta="try-pdf"]', auditId: "hero-button" });

		const field = await measure(page, client, "hero-field", ["focus-visible"]);
		const button = await measure(page, client, "hero-button", ["focus-visible"]);
		assert.deepEqual(
			field.outline,
			button.outline,
			ringShortfall({ field: field.outline, button: button.outline, view: "pdf-ocr/hero" }),
		);
	});

	test("the pdf-ocr close field paints the same focus ring as its button", async ({ page }) => {
		await page.goto(`${BASE_URL}/pdf-ocr`, { waitUntil: "domcontentloaded" });
		const client = await auditContext(page);
		await stamp(page, { selector: "#lp-close-field-try-pdf", auditId: "close-field" });
		await stamp(page, { selector: '[data-test-section="lp-close"] [data-test-cta="try-pdf"]', auditId: "close-button" });

		const field = await measure(page, client, "close-field", ["focus-visible"]);
		const button = await measure(page, client, "close-button", ["focus-visible"]);
		assert.deepEqual(
			field.outline,
			button.outline,
			ringShortfall({ field: field.outline, button: button.outline, view: "pdf-ocr/close" }),
		);
	});
});

test.describe("Form controls hold their WCAG contrast in both themes", () => {
	test.use({ viewport: VIEWPORT });

	test("every text field shows focus with a ring edge that clears 3:1", async ({ page }, testInfo) => {
		await auditFocusRing(page, { path: "/login", selector: LOGIN_EMAIL_FIELD, view: "login/email" });
		const stampId = `${testInfo.workerIndex}-${Date.now()}`;
		const userId = await signInAsNewReader(page, `form-ring-${stampId}@example.com`);
		await seedQueuedArticle(page, { userId, stampId });
		await auditFocusRing(page, { path: "/queue", selector: SAVE_FIELD, view: "queue/save" });
		await auditFocusRing(page, { path: "/queue", selector: SEARCH_FIELD, view: "queue/search" });
	});

	test("the placeholder clears 4.5:1", async ({ page }, testInfo) => {
		const stampId = `${testInfo.workerIndex}-${Date.now()}`;
		const userId = await signInAsNewReader(page, `form-placeholder-${stampId}@example.com`);
		await seedQueuedArticle(page, { userId, stampId });
		await auditPlaceholder(page, { path: "/queue", selector: SAVE_FIELD, view: "queue/save" });
		await auditPlaceholder(page, { path: "/queue", selector: SEARCH_FIELD, view: "queue/search" });
		await auditPlaceholder(page, { path: "/import", selector: FROM_URL_FIELD, view: "import/from-url" });
	});

	test("the review checkbox's focus outline clears 3:1", async ({ page }, testInfo) => {
		await signInAsNewReader(page, `form-choice-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await openImportReview(page, REVIEW_URLS);
		await auditCheckboxFocusRing(page, { before: REVIEW_CHECKBOX_BEFORE, checkbox: REVIEW_CHECKBOX, auditId: "review-checkbox", view: "import/review" });
	});

	test("the Gmail checklist checkbox's focus outline clears 3:1 against its row", async ({ page }, testInfo) => {
		const stampId = `${testInfo.workerIndex}-${Date.now()}`;
		const userId = await signInAsNewReader(page, `gmail-checklist-focus-${stampId}@example.com`);
		await seedGmailChecklist(page, { userId, namespace: `gmail-checklist-focus-${stampId}` });
		await page.goto(`${BASE_URL}/newsletters/gmail?discovery=started`, { waitUntil: "domcontentloaded" });
		await expect(page.locator("body.page-integrations-gmail")).toHaveCount(1);
		await auditCheckboxFocusRing(page, {
			before: GMAIL_CHECKLIST_CHECKBOX_BEFORE,
			checkbox: GMAIL_CHECKLIST_CHECKBOX,
			auditId: "gmail-checklist-checkbox",
			view: "gmail/checklist",
		});
	});
});

test.describe("Menu interaction states hold their WCAG contrast in both themes", () => {
	test.use({ viewport: VIEWPORT });

	test("a menu row keeps its ink under hover and draws its ring inside the panel", async ({ page }, testInfo) => {
		const stampId = `${testInfo.workerIndex}-${Date.now()}`;
		const userId = await signInAsNewReader(page, `menu-contrast-${stampId}@example.com`);
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/menu-contrast-${stampId}`,
				title: "An article with a menu action",
				content: "<p>Seeded body for the menu contrast check.</p>",
				contentFetchedAt: "2026-07-10T09:14:00.000Z",
				savedAt: "2026-07-12T09:14:00.000Z",
				savedByUserId: userId,
				excerpt: "A fixed excerpt for the menu contrast check.",
				generatedSummary: {
					summary: "A fixed summary for the menu contrast check.",
					excerpt: "A fixed excerpt for the menu contrast check.",
				},
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create the article");

		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
			await expect(page.locator("[data-test-article]")).toHaveCount(1);
			await page.locator('[data-test-action="article-menu"]').click();
			const row = page.locator('[data-test-action="delete"].readlist-article__confirm-trigger');
			await expect(row).toBeVisible();
			const client = await auditContext(page);
			await stamp(page, { selector: '[data-test-action="delete"].readlist-article__confirm-trigger', auditId: "menu-delete" });

			const rest = await measure(page, client, "menu-delete", []);
			const hover = await measure(page, client, "menu-delete", ["hover"]);
			const focused = await measure(page, client, "menu-delete", FOCUSED);
			assert.equal(focused.outline.width, 2, `${theme}/queue/menu: the focus ring must be 2px wide`);
			assert.equal(focused.outline.offset, -2, `${theme}/queue/menu: the focus ring must sit inside the row`);
			assert.notEqual(focused.outline.style, "none", `${theme}/queue/menu: the focus ring must be visible`);
			for (const [lensName, lens] of Object.entries(LENSES)) {
				const view = `${theme}/queue/menu/${lensName}`;
				assert.deepEqual(lens(hover.text), lens(rest.text), selectedInkShortfall({ rest, hover, view }));
				assert.ok(labelContrast(hover, lens) >= 4.5, labelShortfall(hover, lens, view));
				const ringContrast = contrastRatio({ ink: lens(focused.outline.colour), surface: lens(focused.fill) });
				assert.ok(
					ringContrast >= NON_TEXT_MINIMUM,
					`${view}: the inset ring clears ${ringContrast.toFixed(2)}:1 < ${NON_TEXT_MINIMUM}:1`,
				);
			}
		}
	});
});

test.describe("Removable tag interaction states hold their WCAG contrast in both themes", () => {
	test.use({ viewport: VIEWPORT });

	test("the readlist tag's remove control keeps a legible x and a 3:1 focus ring on hover and focus", async ({
		page,
	}, testInfo) => {
		const stampId = `${testInfo.workerIndex}-${Date.now()}`;
		const userId = await signInAsNewReader(page, `tag-contrast-${stampId}@example.com`);
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/tag-contrast-${stampId}`,
				title: "An article in a readlist",
				content: "<p>Seeded body for the removable tag contrast check.</p>",
				contentFetchedAt: "2026-07-10T09:14:00.000Z",
				savedByUserId: userId,
				generatedSummary: { summary: "A fixed summary.", excerpt: "A fixed excerpt." },
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create the article");
		const { articleId } = z.object({ articleId: z.string() }).parse(await seeded.json());
		await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
		await createReadlistFromReader(page, "Weekend");

		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
			await expect(page.locator("[data-test-unassign-readlist]")).toBeVisible({ timeout: SETTLE_MS });
			const client = await auditContext(page);
			await stamp(page, { selector: "[data-test-unassign-readlist]", auditId: "tag-remove" });

			const rest = await measure(page, client, "tag-remove", []);
			const hover = await measure(page, client, "tag-remove", ["hover"]);
			const focused = await measure(page, client, "tag-remove", FOCUSED);
			assert.equal(focused.outline.width, 2, `${theme}/reader/tag-remove: the focus ring must be 2px wide`);
			assert.equal(focused.outline.offset, -2, `${theme}/reader/tag-remove: the focus ring must sit inside the control`);
			assert.notEqual(focused.outline.style, "none", `${theme}/reader/tag-remove: the focus ring must be visible`);
			for (const [lensName, lens] of Object.entries(LENSES)) {
				const view = `${theme}/reader/tag-remove/${lensName}`;
				for (const [state, ink] of [["rest", rest], ["hover", hover], ["focus", focused]] as const) {
					const glyph = labelContrast(ink, lens);
					assert.ok(
						glyph >= NON_TEXT_MINIMUM,
						`${view}: the x reads ${glyph.toFixed(2)}:1 on its ${state} fill < ${NON_TEXT_MINIMUM}:1`,
					);
				}
				const ringContrast = contrastRatio({ ink: lens(focused.outline.colour), surface: lens(focused.fill) });
				assert.ok(
					ringContrast >= NON_TEXT_MINIMUM,
					`${view}: the inset ring clears ${ringContrast.toFixed(2)}:1 < ${NON_TEXT_MINIMUM}:1`,
				);
			}
		}
	});
});

test.describe("Reader toolbar interaction states hold their WCAG contrast in both themes", () => {
	test.use({ viewport: VIEWPORT });

	test("reader toolbar controls keep their ink under hover and pressed", async ({ page }, testInfo) => {
		const stampId = `${testInfo.workerIndex}-${Date.now()}`;
		const userId = await signInAsNewReader(page, `toolbar-contrast-${stampId}@example.com`);
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/toolbar-contrast-${stampId}`,
				title: "An article whose toolbar is pressed",
				content: "<p>Seeded body for the reader toolbar contrast check.</p>",
				contentFetchedAt: "2026-07-10T09:14:00.000Z",
				savedByUserId: userId,
				generatedSummary: { summary: "A fixed summary.", excerpt: "A fixed excerpt." },
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create the article");
		const { articleId } = z.object({ articleId: z.string() }).parse(await seeded.json());

		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
			await expect(page.locator('[data-test-action="share-open"]')).toBeVisible({ timeout: SETTLE_MS });
			const client = await auditContext(page);
			for (const control of TOOLBAR_CONTROLS) {
				await stamp(page, { selector: control.selector, auditId: control.auditId });
				const rest = await measure(page, client, control.auditId, []);
				const hover = await measure(page, client, control.auditId, ["hover"]);
				const pressed = await measure(page, client, control.auditId, ["hover", "active"]);
				const view = `${theme}/reader/${control.auditId}`;
				assert.notDeepEqual(hover.fill, rest.fill, `${view}: hovering must repaint the fill`);
				assert.notDeepEqual(pressed.fill, hover.fill, `${view}: pressing must repaint the fill`);
				for (const [lensName, lens] of Object.entries(LENSES)) {
					for (const [state, ink] of [["rest", rest], ["hover", hover], ["pressed", pressed]] as const) {
						const minimum = control.ink === "label" ? textMinimum(ink) : NON_TEXT_MINIMUM;
						const contrast = labelContrast(ink, lens);
						assert.ok(
							contrast >= minimum,
							`${view}/${lensName}: the ${control.ink} reads ${contrast.toFixed(2)}:1 on its ${state} fill < ${minimum}:1`,
						);
					}
				}
			}
		}
	});
});

test.describe("The reader header's Original link holds its WCAG contrast in both themes", () => {
	test.use({ viewport: VIEWPORT });

	test("the header's Original link keeps 4.5:1 at rest and on hover", async ({ page }, testInfo) => {
		const stampId = `${testInfo.workerIndex}-${Date.now()}`;
		const userId = await signInAsNewReader(page, `original-link-contrast-${stampId}@example.com`);
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/original-link-contrast-${stampId}`,
				title: "An article whose header links to the original",
				content: "<p>Seeded body for the Original link contrast check.</p>",
				contentFetchedAt: "2026-07-10T09:14:00.000Z",
				savedByUserId: userId,
				generatedSummary: { summary: "A fixed summary.", excerpt: "A fixed excerpt." },
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create the article");
		const { articleId } = z.object({ articleId: z.string() }).parse(await seeded.json());

		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
			await expect(page.locator("[data-test-original-link]")).toBeVisible({ timeout: SETTLE_MS });
			const client = await auditContext(page);
			await stamp(page, { selector: "[data-test-original-link]", auditId: "original-link" });

			const rest = await measure(page, client, "original-link", []);
			const hover = await measure(page, client, "original-link", ["hover"]);
			for (const [lensName, lens] of Object.entries(LENSES)) {
				for (const [state, ink] of [["rest", rest], ["hover", hover]] as const) {
					const label = labelContrast(ink, lens);
					assert.ok(
						label >= 4.5,
						`${theme}/reader/original-link/${lensName}: the ${state} label reads ${label.toFixed(2)}:1 < 4.5:1`,
					);
				}
			}
		}
	});
});

test.describe("Article history interaction states hold their WCAG contrast in both themes", () => {
	test.use({ viewport: VIEWPORT });

	test("the card's header and a version's delete control stay legible on hover and ring at 3:1 on focus", async ({
		page,
	}, testInfo) => {
		const stampId = `${testInfo.workerIndex}-${Date.now()}`;
		const userId = await signInAsNewReader(page, `article-history-contrast-${stampId}@example.com`);
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/article-history-contrast-${stampId}`,
				title: "An article with a version its reader captured",
				content: "<p>Seeded body for the Article history contrast check.</p>",
				contentFetchedAt: "2026-07-10T09:14:00.000Z",
				savedByUserId: userId,
				crawlVersions: [
					{ crawledAtMinute: "2026-07-10T09:14Z", authorUserId: userId },
					{ crawledAtMinute: "2026-06-28T22:01Z" },
				],
				generatedSummary: { summary: "A fixed summary.", excerpt: "A fixed excerpt." },
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create the article");
		const { articleId } = z.object({ articleId: z.string() }).parse(await seeded.json());

		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
			await expect(page.locator(HISTORY_DELETE)).toBeVisible({ timeout: SETTLE_MS });
			const client = await auditContext(page);
			await stamp(page, { selector: HISTORY_CARD, auditId: "history-card" });
			await stamp(page, { selector: HISTORY_HEADER, auditId: "history-header" });
			await stamp(page, { selector: HISTORY_TITLE, auditId: "history-title" });
			await stamp(page, { selector: HISTORY_DELETE, auditId: "history-delete" });

			const card = await measure(page, client, "history-card", []);
			const headerAtRest = await measure(page, client, "history-header", []);
			const headerHovered = await measure(page, client, "history-header", ["hover"]);
			const titleOnHover = await measure(page, client, "history-title", []);
			const headerFocused = await measure(page, client, "history-header", FOCUSED);
			const deleteAtRest = await measure(page, client, "history-delete", []);
			const deleteHovered = await measure(page, client, "history-delete", ["hover"]);
			const deleteFocused = await measure(page, client, "history-delete", FOCUSED);

			const reader = `${theme}/reader/article-history`;
			assert.notDeepEqual(headerHovered.fill, headerAtRest.fill, `${reader}: hovering the header must repaint its fill`);
			assert.deepEqual(titleOnHover.fill, headerHovered.fill, `${reader}: the title must be measured on the hovered header's fill`);
			assert.notDeepEqual(deleteHovered.fill, deleteAtRest.fill, `${reader}: hovering the delete control must repaint its fill`);
			for (const [name, focused] of [["header", headerFocused], ["delete control", deleteFocused]] as const) {
				assert.equal(focused.outline.width, 2, `${reader}: the ${name}'s focus ring must be 2px wide`);
				assert.equal(focused.outline.offset, 2, `${reader}: the ${name}'s focus ring must sit 2px outside it`);
				assert.notEqual(focused.outline.style, "none", `${reader}: the ${name}'s focus ring must be visible`);
			}
			const insideTheCard: Neighbour = { name: "card", colour: headerFocused.surface };
			const behindTheCard: Neighbour = { name: "page behind the card", colour: card.surface };
			for (const [lensName, lens] of Object.entries(LENSES)) {
				const view = `${reader}/${lensName}`;
				const title = labelContrast(titleOnHover, lens);
				assert.ok(title >= 4.5, `${view}: the title reads ${title.toFixed(2)}:1 on the header's hover fill < 4.5:1`);
				for (const against of [insideTheCard, behindTheCard]) {
					assert.ok(
						edgeContrast({ edge: headerFocused.outline.colour, against, lens }) >= NON_TEXT_MINIMUM,
						edgeShortfall({ edge: headerFocused.outline.colour, against, lens, view: `${view}/header` }),
					);
				}
				const glyph = labelContrast(deleteHovered, lens);
				assert.ok(
					glyph >= NON_TEXT_MINIMUM,
					`${view}: the delete glyph reads ${glyph.toFixed(2)}:1 on its hover fill < ${NON_TEXT_MINIMUM}:1`,
				);
				assert.ok(
					edgeContrast({ edge: deleteFocused.outline.colour, against: insideTheCard, lens }) >= NON_TEXT_MINIMUM,
					edgeShortfall({ edge: deleteFocused.outline.colour, against: insideTheCard, lens, view: `${view}/delete` }),
				);
			}
		}
	});
});

test.describe("Import interaction states hold their WCAG contrast in both themes", () => {
	test.use({ viewport: VIEWPORT });

	test("the dropzone's text stays legible on the tint it takes under hover and focus", async ({ page }, testInfo) => {
		await signInAsNewReader(page, `import-dropzone-contrast-${testInfo.workerIndex}-${Date.now()}@example.com`);

		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${BASE_URL}/import?mode=upload`, { waitUntil: "domcontentloaded" });
			const client = await auditContext(page);
			await stamp(page, { selector: "[data-import-dropzone]", auditId: "dropzone" });
			await stamp(page, { selector: "[data-import-dropzone] .import__dropzone-primary", auditId: "dropzone-primary" });
			await stamp(page, { selector: "[data-import-dropzone] .import__dropzone-meta", auditId: "dropzone-meta" });

			for (const state of ["hover", "focus-within"]) {
				await measure(page, client, "dropzone", [state]);
				for (const auditId of ["dropzone-primary", "dropzone-meta"]) {
					const ink = await measure(page, client, auditId, []);
					for (const [lensName, lens] of Object.entries(LENSES)) {
						assert.ok(
							labelContrast(ink, lens) >= textMinimum(ink),
							labelShortfall(ink, lens, `${theme}/import/${auditId}:${state}/${lensName}`),
						);
					}
				}
			}
		}
	});

	test("a FAQ question rings at 3:1 inside its row", async ({ page }, testInfo) => {
		await signInAsNewReader(page, `import-faq-contrast-${testInfo.workerIndex}-${Date.now()}@example.com`);

		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${BASE_URL}/import`, { waitUntil: "domcontentloaded" });
			const client = await auditContext(page);
			await stamp(page, { selector: "summary.import__faq-summary", auditId: "faq-summary" });

			const focused = await measure(page, client, "faq-summary", FOCUSED);
			const view = `${theme}/import/faq-summary`;
			assert.equal(focused.outline.width, 2, `${view}: the question's focus ring must be 2px wide`);
			assert.equal(focused.outline.offset, -2, `${view}: the question's focus ring must sit 2px inside it`);
			assert.notEqual(focused.outline.style, "none", `${view}: the question's focus ring must be visible`);
			const card: Neighbour = { name: "card", colour: focused.surface };
			for (const [lensName, lens] of Object.entries(LENSES)) {
				assert.ok(
					edgeContrast({ edge: focused.outline.colour, against: card, lens }) >= NON_TEXT_MINIMUM,
					edgeShortfall({ edge: focused.outline.colour, against: card, lens, view: `${view}/${lensName}` }),
				);
			}
		}
	});
});

test.describe("Table of contents interaction states hold their WCAG contrast in both themes", () => {
	test.use({ viewport: VIEWPORT });

	test("a row keeps its ink on its hover fill and rings at 3:1 inside itself, and the current row rings at 3:1 outside its tint", async ({
		page,
	}, testInfo) => {
		const stampId = `${testInfo.workerIndex}-${Date.now()}`;
		const userId = await signInAsNewReader(page, `table-of-contents-contrast-${stampId}@example.com`);
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/table-of-contents-contrast-${stampId}`,
				title: "An article with sections to jump between",
				content:
					"<h2>Why sections matter</h2><p>Seeded body for the table of contents contrast check.</p><h3>Reading in order</h3><p>Seeded body for the table of contents contrast check.</p><h3>Skipping ahead</h3><p>Seeded body for the table of contents contrast check.</p>",
				contentFetchedAt: "2026-07-10T09:14:00.000Z",
				savedByUserId: userId,
				generatedSummary: { summary: "A fixed summary.", excerpt: "A fixed excerpt." },
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create the article");
		const { articleId } = z.object({ articleId: z.string() }).parse(await seeded.json());

		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${BASE_URL}/queue/${articleId}/view`, { waitUntil: "domcontentloaded" });
			await expect(page.locator(TOC_CURRENT_ROW)).toHaveCount(1, { timeout: SETTLE_MS });
			const client = await auditContext(page);
			await stamp(page, { selector: TOC_CARD, auditId: "toc-card" });
			await stamp(page, { selector: TOC_OTHER_ROW, auditId: "toc-row" });
			await stamp(page, { selector: TOC_CURRENT_ROW, auditId: "toc-current-row" });

			const card = await measure(page, client, "toc-card", []);
			const rowAtRest = await measure(page, client, "toc-row", []);
			const rowHovered = await measure(page, client, "toc-row", ["hover"]);
			const rowFocused = await measure(page, client, "toc-row", FOCUSED);
			const currentFocused = await measure(page, client, "toc-current-row", FOCUSED);

			const reader = `${theme}/reader/table-of-contents`;
			assert.notDeepEqual(rowHovered.fill, rowAtRest.fill, `${reader}: hovering a row must repaint its fill`);
			for (const [name, focused, offset] of [
				["row", rowFocused, -2],
				["current row", currentFocused, 2],
			] as const) {
				assert.equal(focused.outline.width, 2, `${reader}: the ${name}'s focus ring must be 2px wide`);
				assert.equal(focused.outline.offset, offset, `${reader}: the ${name}'s focus ring must sit at ${offset}px`);
				assert.notEqual(focused.outline.style, "none", `${reader}: the ${name}'s focus ring must be visible`);
			}
			const insideTheRow: Neighbour = { name: "row's own fill", colour: rowFocused.fill };
			const rowsAround: Neighbour = { name: "rows around it", colour: rowAtRest.fill };
			const behindTheCard: Neighbour = { name: "page behind the card", colour: card.surface };
			for (const [lensName, lens] of Object.entries(LENSES)) {
				const view = `${reader}/${lensName}`;
				assert.deepEqual(
					lens(rowHovered.text),
					lens(rowAtRest.text),
					selectedInkShortfall({ rest: rowAtRest, hover: rowHovered, view }),
				);
				assert.ok(labelContrast(rowHovered, lens) >= textMinimum(rowHovered), labelShortfall(rowHovered, lens, view));
				assert.ok(
					edgeContrast({ edge: rowFocused.outline.colour, against: insideTheRow, lens }) >= NON_TEXT_MINIMUM,
					edgeShortfall({ edge: rowFocused.outline.colour, against: insideTheRow, lens, view: `${view}/row` }),
				);
				for (const against of [rowsAround, behindTheCard]) {
					assert.ok(
						edgeContrast({ edge: currentFocused.outline.colour, against, lens }) >= NON_TEXT_MINIMUM,
						edgeShortfall({ edge: currentFocused.outline.colour, against, lens, view: `${view}/current-row` }),
					);
				}
			}
		}
	});
});

test.describe("Destructive account actions hold their WCAG contrast in both themes", () => {
	test.use({ viewport: VIEWPORT });

	test("Delete account stays legible at rest, on hover and while pressed", async ({ page }, testInfo) => {
		await signInAsNewReader(page, `destructive-contrast-${testInfo.workerIndex}-${Date.now()}@example.com`);
		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${BASE_URL}/account`, { waitUntil: "domcontentloaded" });
			const client = await auditContext(page);
			await stamp(page, {
				selector: "[data-test-danger-open]",
				auditId: "delete-account",
			});
			for (const state of ["rest", "hover", "active"] as const) {
				const ink = await measure(page, client, "delete-account", state === "rest" ? [] : [state]);
				for (const [lensName, lens] of Object.entries(LENSES)) {
					const view = `${theme}/account/delete-account:${state}/${lensName}`;
					assert.ok(labelContrast(ink, lens) >= textMinimum(ink), labelShortfall(ink, lens, view));
					if (state === "rest") {
						const boundary = insetShadowContrast(ink, lens);
						assert.ok(
							boundary >= NON_TEXT_MINIMUM,
							`${view}: ${ink.name} boundary ${boundary.toFixed(2)}:1 < ${NON_TEXT_MINIMUM}:1`,
						);
					}
				}
			}
		}
	});
});

test.describe("The account's Theme choice holds its WCAG contrast in both themes", () => {
	test.use({ viewport: VIEWPORT });

	test("the pressed Theme option rings at 3:1 against its card", async ({ page }, testInfo) => {
		await signInAsNewReader(page, `account-theme-contrast-${testInfo.workerIndex}-${Date.now()}@example.com`);

		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${BASE_URL}/account`, { waitUntil: "domcontentloaded" });
			const client = await auditContext(page);
			await stamp(page, { selector: '[data-test-appearance-option][aria-pressed="true"]', auditId: "theme-pressed" });

			const focused = await measure(page, client, "theme-pressed", FOCUSED);
			const view = `${theme}/account/theme-pressed`;
			assert.equal(focused.outline.width, 2, `${view}: the pressed option's focus ring must be 2px wide`);
			assert.equal(focused.outline.offset, 2, `${view}: the pressed option's focus ring must sit 2px outside it`);
			assert.notEqual(focused.outline.style, "none", `${view}: the pressed option's focus ring must be visible`);
			const card: Neighbour = { name: "card", colour: focused.surface };
			for (const [lensName, lens] of Object.entries(LENSES)) {
				assert.ok(
					edgeContrast({ edge: focused.outline.colour, against: card, lens }) >= NON_TEXT_MINIMUM,
					edgeShortfall({ edge: focused.outline.colour, against: card, lens, view: `${view}/${lensName}` }),
				);
			}
		}
	});
});

test.describe("Move dialog interaction states hold their WCAG contrast in both themes", () => {
	test.use({ viewport: VIEWPORT });

	test("a move-dialog row keeps its ink under hover and rings the whole row on focus", async ({ page }, testInfo) => {
		const stampId = `${testInfo.workerIndex}-${Date.now()}`;
		const userId = await signInAsNewReader(page, `move-contrast-${stampId}@example.com`);
		const seeded = await page.request.post(`${BASE_URL}/e2e/seed-crawled-article`, {
			data: {
				url: `https://example.com/move-contrast-${stampId}`,
				title: "An article to move",
				content: "<p>Seeded body for the move dialog contrast check.</p>",
				contentFetchedAt: "2026-07-10T09:14:00.000Z",
				savedByUserId: userId,
				generatedSummary: { summary: "A fixed summary.", excerpt: "A fixed excerpt." },
			},
		});
		assert.equal(seeded.status(), 201, "the seed endpoint must create the article");
		const { articleId } = z.object({ articleId: z.string() }).parse(await seeded.json());
		for (const label of ["Finance", "Weekend"]) {
			const created = await page.request.post(`${BASE_URL}/queue/queues`, { form: { label } });
			assert.equal(created.status(), 200, "a readlist under the cap must be created and landed on");
		}
		const dialog = `#readlist-move-${articleId}`;
		await page.goto(`${BASE_URL}/queue`, { waitUntil: "domcontentloaded" });
		await page.locator('[data-test-action="article-menu"]').click();
		await page.locator('[data-test-action="move"]').click();
		await page.waitForSelector(`${dialog}:popover-open`);
		await page.keyboard.press("Tab");
		await page.keyboard.press("Space");
		const firstRow = page.locator(`${dialog} [data-test-move-destination]`).first();
		const radio = firstRow.locator('input[type="radio"]');
		await expect(radio).toBeFocused();
		await expect(radio).toBeChecked();
		await expect.poll(() => radio.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
		const slug = await firstRow.getAttribute("data-test-move-destination");
		assert(slug, "every move-dialog row names the readlist it moves the article to");
		const client = await auditContext(page);
		await stamp(page, { selector: `${dialog} [data-test-move-destination="${slug}"]`, auditId: "move-row" });
		await stamp(page, { selector: `${dialog} [data-test-move-destination="${slug}"] input`, auditId: "move-radio" });
		await stamp(page, {
			selector: `${dialog} [data-test-move-destination]:not([data-test-move-destination="${slug}"])`,
			auditId: "move-row-unselected",
		});

		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			const focused = await measure(page, client, "move-row", []);
			const ownRing = await measure(page, client, "move-radio", []);
			const rest = await measure(page, client, "move-row-unselected", []);
			const hover = await measure(page, client, "move-row-unselected", ["hover"]);
			assert.equal(focused.outline.width, 2, `${theme}/queue/move: the row ring must be 2px wide`);
			assert.equal(focused.outline.offset, 2, `${theme}/queue/move: the row ring must sit 2px outside the row`);
			assert.notEqual(focused.outline.style, "none", `${theme}/queue/move: the row ring must be visible`);
			assert.notEqual(ownRing.outline.style, "none", `${theme}/queue/move: the radio must keep its own focus ring`);
			const panel: Neighbour = { name: "panel", colour: focused.surface };
			for (const [lensName, lens] of Object.entries(LENSES)) {
				const view = `${theme}/queue/move/${lensName}`;
				assert.ok(
					edgeContrast({ edge: focused.outline.colour, against: panel, lens }) >= NON_TEXT_MINIMUM,
					edgeShortfall({ edge: focused.outline.colour, against: panel, lens, view }),
				);
				assert.deepEqual(lens(hover.text), lens(rest.text), selectedInkShortfall({ rest, hover, view }));
				assert.ok(labelContrast(hover, lens) >= textMinimum(hover), labelShortfall(hover, lens, view));
			}
		}
	});
});
