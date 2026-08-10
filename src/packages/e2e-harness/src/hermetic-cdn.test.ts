import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { type BrowserContext, type Page, expect as playwrightExpect } from "@playwright/test";
import {
	cdnContextFixture,
	expect as harnessExpect,
	pinCdnFixtures,
	waitForBrandFonts,
} from "./hermetic-cdn";

const FIXTURES_ROOT = path.join(__dirname, "..", "e2e-cdn-fixtures");

type Fulfilled = { path: string; contentType: string };

type RouteFake = {
	fulfill: (options: Fulfilled) => Promise<void>;
	request: () => { url: () => string };
};

type Registration = {
	matches: (url: URL) => boolean;
	handle: (route: RouteFake) => unknown;
};

function createRoutingContext(): { context: BrowserContext; registrations: Registration[] } {
	const registrations: Registration[] = [];
	const context = {
		route: async (matches: Registration["matches"], handle: Registration["handle"]) => {
			registrations.push({ matches, handle });
		},
	};
	return { context: context as unknown as BrowserContext, registrations };
}

async function fulfilledBy(registration: Registration, requestUrl: string): Promise<Fulfilled> {
	let captured: Fulfilled | undefined;
	await registration.handle({
		fulfill: async (options) => {
			captured = options;
		},
		request: () => ({ url: () => requestUrl }),
	});
	assert.ok(captured, `handler for ${requestUrl} must fulfill the route`);
	return captured;
}

type FontEntry = { family: string; status: string };

function createFontPage(fonts: FontEntry[]): { page: Page; verdicts: boolean[] } {
	const verdicts: boolean[] = [];
	const page = {
		waitForFunction: async (predicate: (wanted: string[]) => boolean, wanted: string[]) => {
			Reflect.set(globalThis, "document", {
				fonts: {
					forEach: (visit: (font: FontEntry) => void) => {
						for (const font of fonts) visit(font);
					},
				},
			});
			try {
				verdicts.push(predicate(wanted));
			} finally {
				Reflect.deleteProperty(globalThis, "document");
			}
		},
	};
	return { page: page as unknown as Page, verdicts };
}

describe("pinCdnFixtures", () => {
	it("claims each third-party host and leaves every other host on the network", async () => {
		const { context, registrations } = createRoutingContext();

		await pinCdnFixtures(context);

		const claimed = (url: string) => registrations.map((route) => route.matches(new URL(url)));
		expect(claimed("https://fonts.googleapis.com/css2?family=Inter")).toEqual([true, false]);
		expect(claimed("https://fonts.gstatic.com/s/inter/v20/font.woff2")).toEqual([false, true]);
		expect(claimed("https://readplace.com/queue")).toEqual([false, false]);
	});

	it("answers the stylesheet host with the bundled Inter stylesheet", async () => {
		const { context, registrations } = createRoutingContext();
		await pinCdnFixtures(context);

		const fulfilled = await fulfilledBy(
			registrations[0],
			"https://fonts.googleapis.com/css2?family=Inter:wght@400",
		);

		expect(fulfilled).toEqual({
			path: path.join(FIXTURES_ROOT, "inter.css"),
			contentType: "text/css",
		});
		expect(existsSync(fulfilled.path)).toBe(true);
	});

	it("answers a font request with the bundled file named by the request path", async () => {
		const { context, registrations } = createRoutingContext();
		await pinCdnFixtures(context);

		const fulfilled = await fulfilledBy(
			registrations[1],
			"https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2?v=1",
		);

		expect(fulfilled).toEqual({
			path: path.join(
				FIXTURES_ROOT,
				"gstatic",
				"UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2",
			),
			contentType: "font/woff2",
		});
		expect(existsSync(fulfilled.path)).toBe(true);
	});
});

describe("harness exports", () => {
	it("hands suites Playwright's own expect so assertions and fixtures arrive together", () => {
		expect(harnessExpect).toBe(playwrightExpect);
	});
});

describe("cdnContextFixture", () => {
	it("pins the fixtures before the test body receives the context", async () => {
		const { context, registrations } = createRoutingContext();
		const pinnedWhenHandedOver: number[] = [];
		const handedOver: BrowserContext[] = [];

		await cdnContextFixture({ context }, async (pinned) => {
			pinnedWhenHandedOver.push(registrations.length);
			handedOver.push(pinned);
		});

		expect(pinnedWhenHandedOver).toEqual([2]);
		expect(handedOver).toEqual([context]);
	});
});

describe("waitForBrandFonts", () => {
	it("holds until every wanted family reports a loaded face", async () => {
		const { page, verdicts } = createFontPage([
			{ family: "Inter", status: "loaded" },
			{ family: "Roboto", status: "unloaded" },
		]);

		await waitForBrandFonts(page, ["Inter"]);

		expect(verdicts).toEqual([true]);
	});

	it("stays unsatisfied while a wanted family is still loading", async () => {
		const { page, verdicts } = createFontPage([
			{ family: "Inter", status: "loaded" },
			{ family: "Roboto", status: "unloaded" },
		]);

		await waitForBrandFonts(page, ["Inter", "Roboto"]);

		expect(verdicts).toEqual([false]);
	});
});
