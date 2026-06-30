import assert from "node:assert/strict";
import { By, until } from "selenium-webdriver";
import type { WebDriver } from "selenium-webdriver";
import { CSS_SELECTORS, READER_PERMALINK_PATTERN } from "../e2e";

/** hutch's session cookie (SESSION_COOKIE_NAME in @packages/web-session).
 * The reader at /queue/:id/view resolves its owner from this cookie, never from
 * the bearer, so the extension mints it out-of-band (POST /auth/session) before
 * surfacing reader links. */
const SESSION_COOKIE_NAME = "hutch_sid";

/** Body class of the owner's private reader vs the public fallback view
 * (hutch reader.component.ts / view.component.ts). A saved-article link that
 * carries the session lands on `page-reader`; one that does not 302-redirects to
 * /view and lands on `page-view`. */
const PRIVATE_READER_BODY_CLASS = "page-reader";
const PUBLIC_VIEW_BODY_CLASS = "page-view";

export interface ReaderLinkScenarioConfig {
	/** Origin the extension was built against (HUTCH_SERVER_URL); the reader
	 * permalink and the minted session cookie both live here. */
	serverOrigin: string;
}

/**
 * Asserts the end-to-end outcome of the session-cookie bridge: a saved-article
 * link in the popup opens the owner's PRIVATE reader (/queue/:id/view), not the
 * public /view fallback.
 *
 * Preconditions (driven by the caller): the popup is logged in and showing the
 * reading list with at least one saved article, so the list-load has already
 * fired the fire-and-forget POST /auth/session.
 *
 * The check is split so a failure points at which half of the bridge broke:
 *   1. the popup must target the reader permalink (link rendering),
 *   2. the bridge must mint hutch_sid (POST /auth/session + its CORS),
 *   3. clicking the real link — a cross-site, top-level GET from the extension
 *      origin — must carry the cookie and land on the private reader (the
 *      SameSite=Lax property the fallback bug depended on).
 */
export async function assertReaderLinkOpensPrivateReader(
	driver: WebDriver,
	config: ReaderLinkScenarioConfig,
): Promise<void> {
	const popupWindowHandle = await driver.getWindowHandle();

	const anchor = await driver.wait(
		until.elementLocated(By.css(CSS_SELECTORS.listItem)),
		15_000,
	);
	const readerHref = await anchor.getAttribute("href");
	assert.ok(
		readerHref !== null && READER_PERMALINK_PATTERN.test(readerHref),
		`popup reading-list link must target the private reader permalink, got: ${readerHref}`,
	);

	await assertSessionCookieMinted(driver, config.serverOrigin);
	await driver.switchTo().window(popupWindowHandle);

	// Click the real anchor rather than driver.get(readerHref): an address-bar
	// navigation counts as same-site and would attach the cookie even under
	// SameSite=Strict, masking the very regression this guards. A click from the
	// extension origin is the genuine cross-site top-level navigation.
	const handlesBeforeClick = await driver.getAllWindowHandles();
	await driver.findElement(By.css(CSS_SELECTORS.listItem)).click();
	let readerWindowHandle: string | undefined;
	await driver.wait(async () => {
		const opened = (await driver.getAllWindowHandles()).filter(
			(handle) => !handlesBeforeClick.includes(handle),
		);
		readerWindowHandle = opened[0];
		return readerWindowHandle !== undefined;
	}, 10_000, "clicking the reading-list link should open the reader in a new tab");
	assert.ok(readerWindowHandle, "reader tab window handle was not captured");
	await driver.switchTo().window(readerWindowHandle);

	await driver.wait(
		until.elementLocated(
			By.css(`body.${PRIVATE_READER_BODY_CLASS}, body.${PUBLIC_VIEW_BODY_CLASS}`),
		),
		15_000,
		"reader tab never rendered a reader or view page",
	);
	const bodyClass = await driver
		.findElement(By.css("body"))
		.getAttribute("class");
	assert.ok(
		bodyClass?.includes(PRIVATE_READER_BODY_CLASS),
		`saved-article link opened the public view (body "${bodyClass}") instead of the private reader (body.${PRIVATE_READER_BODY_CLASS}); the session cookie did not carry into the cross-site /queue/:id/view navigation`,
	);
}

/**
 * Confirms the bridge minted hutch_sid, isolating a broken/blocked POST
 * /auth/session (or its credentialed CORS) from a SameSite regression. Reads the
 * cookie from the server origin — cookies are only visible to their own origin's
 * document, and the popup runs on the extension origin — without navigating to
 * the reader, so this step cannot itself smuggle the cookie into the reader.
 */
async function assertSessionCookieMinted(
	driver: WebDriver,
	serverOrigin: string,
): Promise<void> {
	const handlesBefore = await driver.getAllWindowHandles();
	await driver.switchTo().newWindow("tab");
	await driver.get(serverOrigin);
	await driver.wait(async () => {
		const cookies = await driver.manage().getCookies();
		return cookies.some((cookie) => cookie.name === SESSION_COOKIE_NAME);
	}, 10_000, `extension must mint the ${SESSION_COOKIE_NAME} cookie via POST /auth/session`);
	await driver.close();
	const remaining = (await driver.getAllWindowHandles()).filter((handle) =>
		handlesBefore.includes(handle),
	);
	await driver.switchTo().window(remaining[remaining.length - 1]);
}
