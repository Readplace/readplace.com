import assert from "node:assert/strict";
import type { CDPSession, Page } from "@playwright/test";
import { expect, test } from "@packages/e2e-harness";
import { type InteractionInk, collectInteractionInk } from "./interaction-ink.browser";
import { LENSES, NON_TEXT_MINIMUM, type Rgb, contrastRatio, textMinimum } from "./wcag-contrast";

const E2E_PORT = process.env.E2E_PORT;
assert(E2E_PORT, "E2E_PORT must be set by the Playwright webServer config");
const BASE_URL = `http://localhost:${E2E_PORT}`;
const VIEWPORT = { width: 1280, height: 900 };
const SETTLE_MS = 30000;

type Lens = (colour: Rgb) => Rgb;
type Ring = InteractionInk["outline"];

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

	test("the import upload error reads in body ink, not the surface red", async ({ page }) => {
		await page.goto(`${BASE_URL}/import?mode=upload&error_code=import_too_large`, {
			waitUntil: "domcontentloaded",
		});
		const client = await auditContext(page);
		await stamp(page, { selector: "[data-test-import-error]", auditId: "import-error" });

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
