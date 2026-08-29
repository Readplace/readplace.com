import assert from "node:assert/strict";
import { By, until } from "selenium-webdriver";
import type { WebDriver } from "selenium-webdriver";
import { CSS_SELECTORS, READER_PERMALINK_PATTERN, type FlowAction } from "../e2e";
import { captureTransitionFrames } from "./transition-frames";
import { waitForUi } from "./wait-budget";

export interface SaveLinkProgress {
	linkSaved: boolean;
	listVerified: boolean;
	extraLinkSaved: boolean;
}

const EXTRA_LINK_URL = "https://example.com/extra-test-link";
const EXTRA_LINK_TITLE = "Extra Test Link";

const REVEAL_SNAPSHOT_KEY = "__listViewRevealSnapshot";

const INSTALL_REVEAL_PROBE = `
const listView = document.getElementById("list-view");
const linkList = document.getElementById("link-list");
window.${REVEAL_SNAPSHOT_KEY} = null;
const observer = new MutationObserver(() => {
	const revealed = !listView.hidden;
	if (!revealed) return;
	observer.disconnect();
	const rows = document.querySelectorAll(${JSON.stringify(CSS_SELECTORS.listItem)});
	window.${REVEAL_SNAPSHOT_KEY} = [
		linkList.childElementCount,
		...Array.from(rows).map((row) => row.href),
	];
});
observer.observe(listView, { attributes: true, attributeFilter: ["hidden"] });
`;

async function readRevealSnapshot(
	driver: WebDriver,
): Promise<{ rowCount: number; hrefs: string[] } | null> {
	const raw = await driver.executeScript(
		`return window.${REVEAL_SNAPSHOT_KEY};`,
	);
	if (raw === null) return null;
	assert.ok(Array.isArray(raw), "the reveal probe must answer with an array");
	const [rowCount, ...hrefs] = raw;
	return { rowCount: Number(rowCount), hrefs: hrefs.map(String) };
}

export function createSaveLinkActions(config: {
	popupUrl: string;
	testUrl: string;
	testTitle: string;
	popupWindowHandle: string;
	transitionFlow: string;
	progress: SaveLinkProgress;
}): Map<string, FlowAction<WebDriver>> {
	const actions = new Map<string, FlowAction<WebDriver>>();

	actions.set("navigate-to-save-link", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (config.progress.linkSaved) return false;
			try {
				const loginView = await driver.findElement(By.id("login-view"));
				const loginHidden = await loginView.getAttribute("hidden");
				assert.notEqual(loginHidden, null, "login-view should be hidden after login");
				return true;
			} catch {
				return false;
			}
		},
		async execute(driver: WebDriver): Promise<void> {
			const saveUrl = `${config.popupUrl}?url=${encodeURIComponent(config.testUrl)}&title=${encodeURIComponent(config.testTitle)}`;
			await driver.get(saveUrl);
			await waitForUi(driver, async () => {
				try {
					const savedView = await driver.findElement(By.id("saved-view"));
					const savedHidden = await savedView.getAttribute("hidden");
					if (savedHidden === null) return true;
					const listView = await driver.findElement(By.id("list-view"));
					const listHidden = await listView.getAttribute("hidden");
					return listHidden === null;
				} catch {
					return false;
				}
			});
			config.progress.linkSaved = true;
		},
	});

	actions.set("navigate-to-list-after-save", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.progress.linkSaved) return false;
			if (config.progress.listVerified) return false;
			try {
				const savedView = await driver.findElement(By.id("saved-view"));
				const hidden = await savedView.getAttribute("hidden");
				assert.equal(hidden, null, "saved-view should be visible");
				return true;
			} catch {
				return false;
			}
		},
		async execute(driver: WebDriver): Promise<void> {
			await driver.executeScript(INSTALL_REVEAL_PROBE);

			const readlistButton = await driver.findElement(
				By.css(CSS_SELECTORS.savedViewReadlistButton),
			);
			await readlistButton.click();

			await captureTransitionFrames({ driver, flow: config.transitionFlow });

			const revealed = await waitForUi(
				driver,
				() => readRevealSnapshot(driver),
				"the saved view's readlist control never revealed the list view",
			);
			assert.ok(revealed, "the reveal probe resolved without a snapshot");
			assert.ok(
				revealed.rowCount >= 1,
				`the list view became visible with ${revealed.rowCount} rows painted, so the reader saw an empty list first`,
			);
			assert.ok(
				revealed.hrefs.some(
					(href) =>
						href === config.testUrl || READER_PERMALINK_PATTERN.test(href),
				),
				`Expected "${config.testUrl}" or a reader URL among the hrefs at reveal, but found: ${revealed.hrefs.join(", ")}`,
			);
		},
	});

	actions.set("verify-link-in-list", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.progress.linkSaved) return false;
			if (config.progress.listVerified) return false;
			try {
				const listView = await driver.findElement(By.id("list-view"));
				const hidden = await listView.getAttribute("hidden");
				assert.equal(hidden, null, "list-view should be visible");
				return true;
			} catch {
				return false;
			}
		},
		async execute(driver: WebDriver): Promise<void> {
			await waitForUi(
				driver,
				until.elementLocated(By.css(CSS_SELECTORS.listItem)),
			);
			const items = await driver.findElements(By.css(CSS_SELECTORS.listItem));
			const hrefs = await Promise.all(items.map(el => el.getAttribute("href")));
			assert.ok(
				hrefs.some(href => href !== null && (href === config.testUrl || READER_PERMALINK_PATTERN.test(href))),
				`Expected "${config.testUrl}" or a reader URL in list hrefs, but found: ${hrefs.join(", ")}`,
			);
			config.progress.listVerified = true;
		},
	});

	/** Saves a second non-"pagination" URL so the readlist ends up with 12 items
	 * total but only 10 match the filter — keeps the pagination assertion
	 * (page 2 = 2 items) and the filter-with-match assertion (filter hides
	 * pagination because ≤10 matches) consistent. */
	actions.set("save-extra-link", {
		async isAvailable(driver: WebDriver): Promise<boolean> {
			if (!config.progress.listVerified) return false;
			if (config.progress.extraLinkSaved) return false;
			try {
				const listView = await driver.findElement(By.id("list-view"));
				const hidden = await listView.getAttribute("hidden");
				return hidden === null;
			} catch {
				return false;
			}
		},
		async execute(driver: WebDriver): Promise<void> {
			const saveUrl = `${config.popupUrl}?url=${encodeURIComponent(EXTRA_LINK_URL)}&title=${encodeURIComponent(EXTRA_LINK_TITLE)}`;
			await driver.get(saveUrl);
			await waitForUi(driver, async () => {
				try {
					const savedView = await driver.findElement(By.id("saved-view"));
					const savedHidden = await savedView.getAttribute("hidden");
					if (savedHidden === null) return true;
					const listView = await driver.findElement(By.id("list-view"));
					const listHidden = await listView.getAttribute("hidden");
					return listHidden === null;
				} catch {
					return false;
				}
			});
			await driver.get(config.popupUrl);
			await waitForUi(driver, async () => {
				try {
					const listView = await driver.findElement(By.id("list-view"));
					const hidden = await listView.getAttribute("hidden");
					return hidden === null;
				} catch {
					return false;
				}
			});
			config.progress.extraLinkSaved = true;
		},
	});

	return actions;
}
