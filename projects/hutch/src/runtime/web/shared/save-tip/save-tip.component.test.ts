import assert from "node:assert/strict";
import type { Request } from "express";
import { parseHTML } from "linkedom";
import { ALIVE_COOKIE_NAME, ALIVE_COOKIE_VALUE } from "@packages/onboarding-extension-signal";
import { CLICK_SURFACES } from "@packages/web-shell";
import { NATIVE_CLIENT_HEADER } from "../../onboarding/native-client";
import { type SaveTipSpec, buildSaveTip } from "./save-tip.component";
import { SAVE_TIP_ELEMENTS, SAVE_TIP_EVENT_PATH, SAVE_TIP_UTM_SOURCE } from "./save-tip-tracking";

const IPHONE_SAFARI =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const DESKTOP_CHROME =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const DESKTOP_FIREFOX =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0";
const ANDROID_CHROME =
	"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

function request(input: {
	userAgent?: string;
	cookies?: Record<string, string>;
	iosClient?: boolean;
}): Request {
	return {
		headers: { "user-agent": input.userAgent ?? DESKTOP_CHROME },
		cookies: input.cookies ?? {},
		query: {},
		get(name: string) {
			return name.toLowerCase() === NATIVE_CLIENT_HEADER && input.iosClient === true
				? "ios"
				: undefined;
		},
	} as unknown as Request;
}

const ADVISORY_ARTICLE: SaveTipSpec = { kind: "article", mode: "advisory" };
const ADVISORY_IMPORT: SaveTipSpec = { kind: "import", mode: "advisory" };
const GATING_ARTICLE: SaveTipSpec = { kind: "article", mode: "gating", clickSurface: CLICK_SURFACES.readerPublic };

function panelFor(req: Request, spec: SaveTipSpec = ADVISORY_ARTICLE) {
	const { document } = parseHTML(`<main>${buildSaveTip(req, spec).html}</main>`);
	return document;
}

function bodyTextFor(req: Request, spec: SaveTipSpec = ADVISORY_ARTICLE): string {
	const body = panelFor(req, spec).getElementById("save-tip-body");
	assert(body, "the panel must explain why a pasted link may not be enough");
	return body.textContent ?? "";
}

function actionsOf(doc: ReturnType<typeof panelFor>) {
	const actions = doc.querySelector("[data-test-save-tip-mode]");
	assert(actions, "the panel must name the mode its controls were built for");
	return actions;
}

function panelActionsOf(doc: ReturnType<typeof panelFor>): (string | null)[] {
	const panel = doc.querySelector("[data-test-confirm-popover='save-tip']");
	assert(panel, "the save-tip panel must be rendered");
	return Array.from(panel.querySelectorAll("[data-test-action]"), (control) => control.getAttribute("data-test-action"));
}

describe("buildSaveTip", () => {
	it("passes the session's own state through, so the client can tell due from seen", () => {
		const due = buildSaveTip(request({}), ADVISORY_ARTICLE);
		const seen = buildSaveTip(request({ cookies: { rp_save_tip: "seen" } }), ADVISORY_ARTICLE);

		expect(due.state).toBe("due");
		expect(seen.state).toBe("seen");
	});

	it("renders the panel even once the session has seen it, so the markup is one shape", () => {
		const doc = panelFor(request({ cookies: { rp_save_tip: "seen" } }));

		const panel = doc.querySelector("[data-test-confirm-popover='save-tip']");
		assert(panel, "the panel is always rendered; the state attribute decides whether it opens");
		expect(panel.getAttribute("data-test-confirm-subject")).toBe("article");
	});

	it("continues with the URL and closes with no script, since it holds nothing back", () => {
		const doc = panelFor(request({}));

		expect(actionsOf(doc).getAttribute("data-test-save-tip-mode")).toBe("advisory");
		const proceed = doc.querySelector("[data-test-action='save-tip-continue']");
		assert(proceed, "the advisory panel must offer a way to continue");
		expect(proceed.textContent).toBe("Continue with URL");
		expect(proceed.getAttribute("type")).toBe("button");
		expect(proceed.getAttribute("popovertarget")).toBe("save-tip");
		expect(proceed.getAttribute("popovertargetaction")).toBe("hide");
		expect(proceed.classList.contains("btn--neutral")).toBe(true);
		expect(proceed.hasAttribute("data-save-tip-proceed")).toBe(false);
	});

	it("offers a way through where it does hold a link back", () => {
		const doc = panelFor(request({}), GATING_ARTICLE);

		expect(actionsOf(doc).getAttribute("data-test-save-tip-mode")).toBe("gating");
		const proceed = doc.querySelector("[data-test-action='save-tip-proceed']");
		assert(proceed, "the gating panel must offer a way to continue");
		expect(proceed.textContent).toBe("Save the link anyway");
		expect(proceed.getAttribute("type")).toBe("button");
		expect(proceed.classList.contains("btn--neutral")).toBe(true);
		expect(proceed.hasAttribute("data-save-tip-proceed")).toBe(true);
	});

	it("pitches the install alongside either control, since the advice is the same", () => {
		const gating = panelFor(request({ userAgent: DESKTOP_CHROME }), GATING_ARTICLE);

		const install = gating.querySelector("[data-test-action='save-tip-install']");
		assert(install, "a visitor with no client must be offered one either way");
		expect(install.textContent).toBe("Explore saving options");
		expect(install.classList.contains("btn--primary")).toBe(true);
		expect(new URL(install.getAttribute("href") ?? "", "https://readplace.com").pathname).toBe(
			"/install",
		);
	});

	it("puts the install path last, as the panel's one primary", () => {
		expect(panelActionsOf(panelFor(request({}), ADVISORY_ARTICLE))).toEqual([
			"save-tip-continue",
			"save-tip-install",
		]);
		expect(panelActionsOf(panelFor(request({}), GATING_ARTICLE))).toEqual([
			"save-tip-proceed",
			"save-tip-install",
		]);
	});

	it("sits its controls in the shell's row", () => {
		const actions = actionsOf(panelFor(request({})));
		expect(actions.classList.contains("confirm-popover__actions")).toBe(true);
		expect(actions.classList.contains("confirm-popover__buttons")).toBe(true);
	});

	it.each([
		["extension", { cookies: { [ALIVE_COOKIE_NAME]: ALIVE_COOKIE_VALUE } }],
		["app", { userAgent: IPHONE_SAFARI, iosClient: true }],
	])("promotes the continue control to primary for the %s client", (client, input) => {
		const doc = panelFor(request(input));
		expect(actionsOf(doc).getAttribute("data-test-save-tip-variant")).toBe(client);
		expect(panelActionsOf(doc)).toEqual(["save-tip-continue"]);
		const proceed = doc.querySelector("[data-test-action='save-tip-continue']");
		assert(proceed, "the installed client still needs a way to continue");
		expect(proceed.classList.contains("btn--primary")).toBe(true);
	});

	it.each([ADVISORY_ARTICLE, ADVISORY_IMPORT])("leads the %s panel with the book-lightbulb illustration", (spec) => {
		const doc = panelFor(request({}), spec);
		const panel = doc.querySelector("[data-test-confirm-popover='save-tip']");
		assert(panel, "the save-tip panel must be rendered");
		expect(panel.classList.contains("confirm-popover--illustrated")).toBe(true);
		const art = panel.querySelector(".confirm-popover__illustration svg");
		assert(art, "the illustrated panel must lead with art");
		expect(art.getAttribute("data-test-illustration")).toBe("book-lightbulb");
	});

	it("names the better ways to save rather than the fetch that cannot reach them", () => {
		const doc = panelFor(request({}));

		const title = doc.getElementById("save-tip-title");
		assert(title, "the article panel must have its own title");
		expect(title.textContent).toBe("Save articles the better way");
		expect(bodyTextFor(request({}))).toBe(
			"Use the Readplace browser extension or other supported options to save articles in one click and get a cleaner reading experience.",
		);
	});

	it.each([
		["desktop Chrome", { userAgent: DESKTOP_CHROME }, "Use the Readplace browser extension or other supported options to save articles in one click and get a cleaner reading experience."],
		["desktop Firefox", { userAgent: DESKTOP_FIREFOX }, "Use the Readplace browser extension or other supported options to save articles in one click and get a cleaner reading experience."],
		["iPhone Safari", { userAgent: IPHONE_SAFARI }, "Use the Readplace iPhone app or other supported options to save articles in one tap and get a cleaner reading experience."],
		["native app", { userAgent: IPHONE_SAFARI, iosClient: true }, "Use the Readplace share sheet to save articles in one tap and get a cleaner reading experience."],
		["installed extension", { userAgent: DESKTOP_CHROME, cookies: { [ALIVE_COOKIE_NAME]: ALIVE_COOKIE_VALUE } }, "Use the Readplace browser extension or other supported options to save articles in one click and get a cleaner reading experience."],
		["Android", { userAgent: ANDROID_CHROME }, "Use one of Readplace's supported options to save articles in one click and get a cleaner reading experience."],
		["unrecognised device", { userAgent: "Unrecognised device" }, "Use one of Readplace's supported options to save articles in one click and get a cleaner reading experience."],
	])("names the save method for %s", (_label, input, expected) => {
		expect(bodyTextFor(request(input))).toBe(expected);
	});

	describe("what the panel reports to the internal-click stream", () => {
		function beaconOn(doc: ReturnType<typeof panelFor>, selector: string): URL {
			const element = doc.querySelector(selector);
			assert(element, `${selector} must be rendered so its use can be counted`);
			const url = element.getAttribute("data-beacon-url");
			assert(url, `${selector} must carry the URL that records its use`);
			return new URL(url, "https://readplace.com");
		}

		function elementOf(url: URL): string | null {
			expect(url.pathname).toBe(SAVE_TIP_EVENT_PATH);
			expect(url.searchParams.get("utm_source")).toBe(SAVE_TIP_UTM_SOURCE);
			expect(url.searchParams.get("utm_medium")).toBe("internal");
			return url.searchParams.get("utm_content");
		}

		it("reports the panel opening from the panel itself", () => {
			const doc = panelFor(request({}));

			expect(elementOf(beaconOn(doc, "[data-test-confirm-popover='save-tip']"))).toBe(
				SAVE_TIP_ELEMENTS.opened,
			);
		});

		it("reports continuing with the URL", () => {
			const advisory = panelFor(request({}));
			const gating = panelFor(request({}), GATING_ARTICLE);
			const beaconElements = (doc: ReturnType<typeof panelFor>) => Array.from(
				doc.querySelectorAll("[data-beacon-url]"),
				(element) => elementOf(new URL(element.getAttribute("data-beacon-url") ?? "", "https://readplace.com")),
			);
			expect(beaconElements(advisory)).toEqual(["opened", "continued"]);
			expect(beaconElements(gating)).toEqual(["opened"]);
		});

		it("leaves the install link to the click its own navigation already records", () => {
			const doc = panelFor(request({ userAgent: DESKTOP_CHROME }));

			const install = doc.querySelector("[data-test-action='save-tip-install']");
			assert(install, "a visitor with no client must be offered one");
			expect(install.hasAttribute("data-beacon-url")).toBe(false);
			const href = new URL(install.getAttribute("href") ?? "", "https://readplace.com");
			expect(href.searchParams.get("utm_source")).toBe(SAVE_TIP_UTM_SOURCE);
			expect(href.searchParams.get("utm_content")).toBe(SAVE_TIP_ELEMENTS.install);
		});

		it("reports the panel opening on the gated surface too, which opens it again per link", () => {
			const doc = panelFor(request({}), GATING_ARTICLE);

			expect(elementOf(beaconOn(doc, "[data-test-confirm-popover='save-tip']"))).toBe(
				SAVE_TIP_ELEMENTS.opened,
			);
		});

		it("marks the gated panel's beacons and install pitch with the reader-public surface so they attribute to the reader view", () => {
			const doc = panelFor(request({ userAgent: DESKTOP_CHROME }), GATING_ARTICLE);

			expect(beaconOn(doc, "[data-test-confirm-popover='save-tip']").searchParams.get("utm_term")).toBe("reader-public");
			const install = doc.querySelector("[data-test-action='save-tip-install']");
			assert(install, "a visitor with no client must be offered one on the gated surface");
			expect(new URL(install.getAttribute("href") ?? "", "https://readplace.com").searchParams.get("utm_term")).toBe(
				"reader-public",
			);
		});

		it("leaves the advisory panel's beacons and install pitch unmarked by a surface, since it renders on the homepage too", () => {
			const doc = panelFor(request({ userAgent: DESKTOP_CHROME }));

			expect(beaconOn(doc, "[data-test-confirm-popover='save-tip']").searchParams.has("utm_term")).toBe(false);
			const install = doc.querySelector("[data-test-action='save-tip-install']");
			assert(install, "a visitor with no client must be offered one");
			expect(new URL(install.getAttribute("href") ?? "", "https://readplace.com").searchParams.has("utm_term")).toBe(false);
		});
	});

	describe("when the visitor has no content-capture client", () => {
		it("pitches an install, aimed at what this device can actually take", () => {
			const doc = panelFor(request({ userAgent: DESKTOP_CHROME }));

			const variant = doc.querySelector("[data-test-save-tip-variant]");
			assert(variant, "the panel must name the client variant it rendered");
			expect(variant.getAttribute("data-test-save-tip-variant")).toBe("none");
			const install = doc.querySelector("[data-test-action='save-tip-install']");
			assert(install, "a visitor with no client must be offered one");
			const url = new URL(install.getAttribute("href") ?? "", "https://readplace.com");
			expect(url.pathname).toBe("/install");
			expect(url.searchParams.get("client")).toBe("chrome");
			expect(url.searchParams.get("utm_source")).toBe("save-tip");
		});
	});

	describe("the import surface", () => {
		it("warns about the links it is about to fetch, not about one article", () => {
			const doc = panelFor(request({}), ADVISORY_IMPORT);

			const title = doc.getElementById("save-tip-title");
			assert(title, "the import panel must have its own title");
			expect(title.textContent).toBe("Some of these may arrive as links only");
			expect(actionsOf(doc).getAttribute("data-test-save-tip-mode")).toBe("advisory");
			const proceed = doc.querySelector("[data-test-action='save-tip-continue']");
			assert(proceed, "the import panel must offer a way to continue");
			expect(proceed.textContent).toBe("Continue with URL");
		});

		it.each([
			["no client", {}, "Some sites block Readplace from fetching article text. For individual articles, the browser extension and the iPhone app can save the full page."],
			["extension", { cookies: { [ALIVE_COOKIE_NAME]: ALIVE_COOKIE_VALUE } }, "Some sites block Readplace from fetching article text. For individual articles, the extension can save the full page."],
			["app", { userAgent: IPHONE_SAFARI, iosClient: true }, "Some sites block Readplace from fetching article text. For individual articles, the Readplace share sheet can save the full page."],
		])("explains the link-only outcome for the %s client", (_client, input, expected) => {
			expect(bodyTextFor(request(input), ADVISORY_IMPORT)).toBe(expected);
		});

		it("still offers the install for the single articles a client can capture", () => {
			const doc = panelFor(request({ userAgent: IPHONE_SAFARI }), ADVISORY_IMPORT);

			const install = doc.querySelector("[data-test-action='save-tip-install']");
			assert(install, "the install offer stands for the next single article");
			const url = new URL(install.getAttribute("href") ?? "", "https://readplace.com");
			expect(url.searchParams.get("client")).toBe("iphone");
		});
	});
});
