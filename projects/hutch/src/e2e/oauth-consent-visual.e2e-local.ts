import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import { captureCheckpoint, test, type VisualCheckpoint } from "@packages/e2e-harness";
import { requireEnv } from "@packages/require-env";
import { openBuiltInConsent, openMcpConsent } from "./oauth-consent";
import { type MeasuredBox, measureBoxes, pageOverflowsSideways } from "./page-measurements.browser";

const BASE_URL = `http://127.0.0.1:${requireEnv("E2E_PORT")}`;
const EXTENSION_REDIRECT_URI = `${BASE_URL}/oauth/callback`;
const IOS_REDIRECT_URI = "readplace://oauth-callback";

const CONSENT_PAGE = "body.page-oauth-authorize main.auth-page";
const CONSENT_CARD = "body.page-oauth-authorize .auth-card";
const HEADER = "header.header";
const TITLE = `${CONSENT_CARD} .oauth-authorize__title`;
const NOTICE = `${CONSENT_CARD} [data-test-alert="consent-notice"]`;
const CANCEL = `${CONSENT_CARD} button[value="deny"]`;
const ALLOW = `${CONSENT_CARD} button[value="approve"]`;
const SWITCH = `${CONSENT_CARD} button[value="switch"]`;

const CARD_BORDER_AND_PADDING_PX = 25;
const BUTTON_HEIGHT_PX = 48;
const FRAME_CANCEL_WIDTH_PX = 103;
const FRAME_ALLOW_WIDTH_PX = 152;
const BUTTON_GAP_PX = 8;
const SWITCH_HIT_BOX_PX = 44;

interface ConsentLayout {
	viewport: { width: number; height: number };
	cardWidth: number;
	cardTop: number;
}

const DESKTOP: ConsentLayout = { viewport: { width: 1280, height: 900 }, cardWidth: 534, cardTop: 32 };
const PHONE: ConsentLayout = { viewport: { width: 390, height: 844 }, cardWidth: 350, cardTop: 20 };
const NARROW_PHONE = { width: 320, height: 640 };

function assertNear(input: { actual: number; expected: number; tolerance: number }, message: string): void {
	assert.ok(
		Math.abs(input.actual - input.expected) <= input.tolerance,
		`${message}, measured ${input.actual} against ${input.expected}`,
	);
}

function assertInsideContentBox(input: { box: MeasuredBox; card: MeasuredBox; name: string }): void {
	const contentLeft = input.card.x + CARD_BORDER_AND_PADDING_PX;
	const contentRight = input.card.x + input.card.width - CARD_BORDER_AND_PADDING_PX;
	assert.ok(
		input.box.x >= contentLeft - 1 && input.box.x + input.box.width <= contentRight + 1,
		`${input.name} must sit inside the consent card's content box, measured ${input.box.x}–${input.box.x + input.box.width} against ${contentLeft}–${contentRight}`,
	);
}

function consentGeometry(layout: ConsentLayout): (page: Page) => Promise<void> {
	return async (page) => {
		const [header, main, card, title, cancel, allow, switchAccount] = await page.evaluate(measureBoxes, [
			HEADER,
			CONSENT_PAGE,
			CONSENT_CARD,
			TITLE,
			CANCEL,
			ALLOW,
			SWITCH,
		]);
		assertNear(
			{ actual: card.x - main.x, expected: main.x + main.width - (card.x + card.width), tolerance: 1 },
			"the consent card's left and right margins match",
		);
		assertNear({ actual: card.width, expected: layout.cardWidth, tolerance: 0.5 }, "the consent card's width");
		assertNear(
			{ actual: card.y - (header.y + header.height), expected: layout.cardTop, tolerance: 0.5 },
			"the consent card's gap under the header",
		);
		assertNear(
			{ actual: title.x - card.x, expected: CARD_BORDER_AND_PADDING_PX, tolerance: 0.5 },
			"the consent card pads its content 24px inside its border",
		);
		assertNear({ actual: cancel.x, expected: title.x, tolerance: 1 }, "Cancel starts on the title's left edge");
		assertNear({ actual: allow.y, expected: cancel.y, tolerance: 0.5 }, "Allow access shares Cancel's top edge");
		assertNear(
			{ actual: allow.x - (cancel.x + cancel.width), expected: BUTTON_GAP_PX, tolerance: 0.5 },
			"Allow access sits 8px after Cancel",
		);
		assertNear({ actual: cancel.height, expected: BUTTON_HEIGHT_PX, tolerance: 0.5 }, "Cancel is an L button");
		assertNear({ actual: cancel.width, expected: FRAME_CANCEL_WIDTH_PX, tolerance: 2 }, "Cancel is as wide as the frame draws it");
		assertNear({ actual: allow.width, expected: FRAME_ALLOW_WIDTH_PX, tolerance: 2 }, "Allow access is as wide as the frame draws it");
		assertNear(
			{
				actual: card.x + card.width - CARD_BORDER_AND_PADDING_PX - (allow.x + allow.width),
				expected: layout.cardWidth - 2 * CARD_BORDER_AND_PADDING_PX - (FRAME_CANCEL_WIDTH_PX + BUTTON_GAP_PX + FRAME_ALLOW_WIDTH_PX),
				tolerance: 4.5,
			},
			"the button pair ends short of the card's content edge",
		);
		assertNear({ actual: switchAccount.x, expected: title.x, tolerance: 1 }, "Use a different account starts on the title's left edge");
		assertNear(
			{ actual: switchAccount.height, expected: SWITCH_HIT_BOX_PX, tolerance: 0.5 },
			"Use a different account keeps a 44px hit box",
		);
		assert.ok(
			allow.x >= card.x && allow.x + allow.width <= card.x + card.width,
			"the approve button must sit inside the consent card rather than overflow it",
		);
	};
}

function consentCheckpoint(input: {
	name: string;
	settled: (page: Page) => Promise<void>;
	layout: ConsentLayout;
}): VisualCheckpoint {
	return {
		name: input.name,
		settled: input.settled,
		geometry: consentGeometry(input.layout),
		target: CONSENT_CARD,
		capture: "element",
		pinnedText: [],
	};
}

test.describe("OAuth consent page for a built-in browser extension", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP.viewport });

	for (const theme of ["light", "dark"] as const) {
		test(`asks to connect the Chrome extension with Cancel before Allow access (${theme})`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: theme });
			await captureCheckpoint(
				page,
				consentCheckpoint({
					name: `oauth-consent-extension-${theme}`,
					settled: (settling) =>
						openBuiltInConsent(settling, {
							baseUrl: BASE_URL,
							clientId: "hutch-chrome-extension",
							redirectUri: EXTENSION_REDIRECT_URI,
							email: `consent-extension-${theme}@example.com`,
						}),
					layout: DESKTOP,
				}),
			);
		});
	}
});

test.describe("OAuth consent page for the iPhone app", () => {
	test.use({ timezoneId: "UTC", viewport: PHONE.viewport });

	test("asks to connect the iOS app on a phone-width card", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await captureCheckpoint(
			page,
			consentCheckpoint({
				name: "oauth-consent-app-phone-light",
				settled: (settling) =>
					openBuiltInConsent(settling, {
						baseUrl: BASE_URL,
						clientId: "ios-app",
						redirectUri: IOS_REDIRECT_URI,
						email: "consentphone@example.com",
					}),
				layout: PHONE,
			}),
		);
	});
});

test.describe("OAuth consent page for a self-registered connector", () => {
	test.use({ timezoneId: "UTC", viewport: DESKTOP.viewport });

	for (const theme of ["light", "dark"] as const) {
		test(`warns that the connector registered itself (${theme})`, async ({ page }) => {
			await page.emulateMedia({ colorScheme: theme });
			await captureCheckpoint(
				page,
				consentCheckpoint({
					name: `oauth-consent-mcp-${theme}`,
					settled: (settling) =>
						openMcpConsent(settling, { baseUrl: BASE_URL, email: `connector-consent-${theme}@example.com` }),
					layout: DESKTOP,
				}),
			);
		});
	}
});

test.describe("OAuth consent page at the narrowest phone width", () => {
	test.use({ timezoneId: "UTC", viewport: NARROW_PHONE });

	test("wraps Allow access under Cancel and keeps every control inside the card", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await openMcpConsent(page, { baseUrl: BASE_URL, email: "connector-consent-narrow@example.com" });

		assert.equal(await page.evaluate(pageOverflowsSideways), false, "the consent page must not scroll sideways at 320px");
		const [card, notice, cancel, allow, switchAccount] = await page.evaluate(measureBoxes, [
			CONSENT_CARD,
			NOTICE,
			CANCEL,
			ALLOW,
			SWITCH,
		]);
		assertInsideContentBox({ box: notice, card, name: "The warning" });
		assertInsideContentBox({ box: cancel, card, name: "Cancel" });
		assertInsideContentBox({ box: allow, card, name: "Allow access" });
		assertInsideContentBox({ box: switchAccount, card, name: "Use a different account" });
		assertNear(
			{ actual: allow.y, expected: cancel.y + cancel.height + BUTTON_GAP_PX, tolerance: 0.5 },
			"Allow access wraps 8px under Cancel",
		);
		assertNear({ actual: allow.x, expected: cancel.x, tolerance: 1 }, "Allow access wraps onto Cancel's left edge");
	});
});
