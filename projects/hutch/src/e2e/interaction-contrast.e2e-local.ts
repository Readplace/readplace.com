import assert from "node:assert/strict";
import type { CDPSession, Page } from "@playwright/test";
import { expect, test } from "@packages/e2e-harness";
import { type InteractionInk, collectInteractionInk } from "./interaction-ink.browser";
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
const REVIEW_URLS = [
	"https://example.com/essays/focus-ring-first",
	"https://example.com/essays/focus-ring-second",
	"https://example.com/essays/focus-ring-third",
];
const REVIEW_CHECKBOX_BEFORE = '[data-test-import-checkbox="0"]';
const REVIEW_CHECKBOX = '[data-test-import-checkbox="1"]';

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
	let ink: InteractionInk | undefined;
	let previous = "";
	await expect
		.poll(
			async () => {
				ink = await page.evaluate(collectInteractionInk, auditId);
				const current = JSON.stringify(ink);
				const settled = current === previous;
				previous = current;
				return settled;
			},
			{ timeout: SETTLE_MS },
		)
		.toBe(true);
	assert(ink, "the settle loop must have measured the element");
	return ink;
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

function placeholderContrast(ink: PlaceholderInk, lens: Lens): number {
	return contrastRatio({ ink: lens(ink.placeholder), surface: lens(ink.fill) });
}

function placeholderShortfall(ink: PlaceholderInk, lens: Lens, view: string): string {
	return `${view}: ${ink.name} placeholder ${placeholderContrast(ink, lens).toFixed(2)}:1 < ${textMinimum(ink)}:1`;
}

async function signInAsNewReader(page: Page, email: string): Promise<void> {
	const created = await page.request.post(`${BASE_URL}/e2e/users`, {
		data: { email, password: PASSWORD, verified: true },
	});
	assert.equal(created.status(), 201, "the e2e user fixture must answer the create request");
	await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
	await page.locator("#email").fill(email);
	await page.locator("#password").fill(PASSWORD);
	await page.locator('[data-test-form="login"] button[type="submit"]').click();
	await page.waitForSelector("body.page-readlist");
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
		await stamp(page, { selector: '[data-test-tab="chrome"].install-page__tab--active', auditId: "install-tab" });

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
		await stamp(page, { selector: '[data-test-import-tab="from-url"].import__tab--active', auditId: "import-tab" });

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

	test("the import dropzone's link stays legible on the tint it takes under hover and focus", async ({ page }) => {
		await page.goto(`${BASE_URL}/import?mode=upload`, { waitUntil: "domcontentloaded" });
		const client = await auditContext(page);
		await stamp(page, { selector: "[data-import-dropzone]", auditId: "dropzone" });
		await stamp(page, { selector: "[data-import-dropzone] .import__dropzone-link", auditId: "dropzone-link" });

		for (const state of ["hover", "focus-within"]) {
			await measure(page, client, "dropzone", [state]);
			const ink = await measure(page, client, "dropzone-link", []);
			for (const lens of Object.values(LENSES)) {
				assert.ok(
					labelContrast(ink, lens) >= textMinimum(ink),
					labelShortfall(ink, lens, `import/dropzone-link:${state}`),
				);
			}
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
		await signInAsNewReader(page, `form-ring-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await auditFocusRing(page, { path: "/queue", selector: SAVE_FIELD, view: "queue/save" });
	});

	test("the placeholder clears 4.5:1", async ({ page }, testInfo) => {
		await signInAsNewReader(page, `form-placeholder-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await auditPlaceholder(page, { path: "/queue", selector: SAVE_FIELD, view: "queue/save" });
		await auditPlaceholder(page, { path: "/import", selector: FROM_URL_FIELD, view: "import/from-url" });
	});

	test("the review checkbox's focus outline clears 3:1", async ({ page }, testInfo) => {
		await signInAsNewReader(page, `form-choice-${testInfo.workerIndex}-${Date.now()}@example.com`);
		await openImportReview(page, REVIEW_URLS);
		await page.locator(REVIEW_CHECKBOX_BEFORE).focus();
		await page.keyboard.press("Tab");
		const checkbox = page.locator(REVIEW_CHECKBOX);
		await expect(checkbox).toBeFocused();
		await expect.poll(() => checkbox.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
		const client = await auditContext(page);
		await stamp(page, { selector: REVIEW_CHECKBOX, auditId: "review-checkbox" });

		for (const theme of THEMES) {
			await page.emulateMedia({ colorScheme: theme });
			const ink = await measure(page, client, "review-checkbox", []);
			assert.notEqual(ink.outline.style, "none", `${theme}/import/review: ${ink.name} draws no focus outline`);
			assert.ok(ink.outline.width > 0, `${theme}/import/review: ${ink.name} draws a zero-width focus outline`);
			const row: Neighbour = { name: "row", colour: ink.surface };
			for (const [lensName, lens] of Object.entries(LENSES)) {
				assert.ok(
					edgeContrast({ edge: ink.outline.colour, against: row, lens }) >= NON_TEXT_MINIMUM,
					edgeShortfall({
						edge: ink.outline.colour,
						against: row,
						lens,
						view: `${theme}/import/review/${lensName}`,
					}),
				);
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
				selector: '[data-test-danger-action="delete-account"] button[type="submit"]',
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
