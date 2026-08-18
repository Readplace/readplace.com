import assert from "node:assert/strict";
import type { Request } from "express";
import { parseHTML } from "linkedom";
import { ALIVE_COOKIE_NAME, ALIVE_COOKIE_VALUE } from "@packages/onboarding-extension-signal";
import { IOS_CLIENT_HEADER, IOS_CLIENT_VALUE } from "../../onboarding/ios-client";
import { type SaveTipSpec, buildSaveTip } from "./save-tip.component";
import { SAVE_TIP_ELEMENTS, SAVE_TIP_EVENT_PATH, SAVE_TIP_UTM_SOURCE } from "./save-tip-tracking";

const IPHONE_SAFARI =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const DESKTOP_CHROME =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

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
			return name.toLowerCase() === IOS_CLIENT_HEADER && input.iosClient === true
				? IOS_CLIENT_VALUE
				: undefined;
		},
	} as unknown as Request;
}

const ADVISORY_ARTICLE: SaveTipSpec = { kind: "article", mode: "advisory" };
const ADVISORY_IMPORT: SaveTipSpec = { kind: "import", mode: "advisory" };
const GATING_ARTICLE: SaveTipSpec = { kind: "article", mode: "gating" };

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

	it("acknowledges and closes with no script, since it holds nothing back", () => {
		const doc = panelFor(request({}));

		expect(actionsOf(doc).getAttribute("data-test-save-tip-mode")).toBe("advisory");
		const acknowledge = doc.querySelector("[data-test-action='save-tip-acknowledge']");
		assert(acknowledge, "the advisory panel must offer a way to dismiss it");
		expect(acknowledge.textContent).toBe("Got it");
		expect(acknowledge.getAttribute("type")).toBe("button");
		expect(acknowledge.getAttribute("popovertarget")).toBe("save-tip");
		expect(acknowledge.getAttribute("popovertargetaction")).toBe("hide");
		expect(acknowledge.hasAttribute("data-save-tip-proceed")).toBe(false);
	});

	it("offers a way through where it does hold a link back", () => {
		const doc = panelFor(request({}), GATING_ARTICLE);

		expect(actionsOf(doc).getAttribute("data-test-save-tip-mode")).toBe("gating");
		const proceed = doc.querySelector("[data-test-action='save-tip-proceed']");
		assert(proceed, "the gating panel must offer a way to continue");
		expect(proceed.textContent).toBe("Save the link anyway");
		expect(proceed.getAttribute("type")).toBe("button");
		expect(proceed.hasAttribute("data-save-tip-proceed")).toBe(true);
	});

	it("pitches the install alongside either control, since the advice is the same", () => {
		const gating = panelFor(request({ userAgent: DESKTOP_CHROME }), GATING_ARTICLE);

		const install = gating.querySelector("[data-test-action='save-tip-install']");
		assert(install, "a visitor with no client must be offered one either way");
		expect(install.textContent).toBe("See better ways to save");
		expect(new URL(install.getAttribute("href") ?? "", "https://readplace.com").pathname).toBe(
			"/install",
		);
	});

	it("names the better ways to save rather than the fetch that cannot reach them", () => {
		const doc = panelFor(request({}));

		const title = doc.getElementById("save-tip-title");
		assert(title, "the article panel must have its own title");
		expect(title.textContent).toBe("There are better ways to save!");
		expect(bodyTextFor(request({}))).toBe(
			"Readplace strongly recommends to use our dedicated clients to save content so you can always get a clean reader view.",
		);
	});

	it("recommends the clients in the same words whatever the visitor already has", () => {
		const withoutClient = bodyTextFor(request({ userAgent: DESKTOP_CHROME }));

		expect(bodyTextFor(request({ cookies: { [ALIVE_COOKIE_NAME]: ALIVE_COOKIE_VALUE } }))).toBe(
			withoutClient,
		);
		expect(bodyTextFor(request({ userAgent: IPHONE_SAFARI, iosClient: true }))).toBe(
			withoutClient,
		);
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

		it("tells closing it apart from acknowledging it", () => {
			const doc = panelFor(request({}));

			expect(elementOf(beaconOn(doc, "[data-test-action='save-tip-dismiss']"))).toBe(
				SAVE_TIP_ELEMENTS.dismissed,
			);
			expect(elementOf(beaconOn(doc, "[data-test-action='save-tip-acknowledge']"))).toBe(
				SAVE_TIP_ELEMENTS.acknowledged,
			);
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

	describe("when the extension is already installed", () => {
		it("tells the reader to use it instead of offering it again", () => {
			const doc = panelFor(
				request({ cookies: { [ALIVE_COOKIE_NAME]: ALIVE_COOKIE_VALUE } }),
			);

			const variant = doc.querySelector("[data-test-save-tip-variant]");
			assert(variant, "the panel must name the client variant it rendered");
			expect(variant.getAttribute("data-test-save-tip-variant")).toBe("extension");
			expect(variant.querySelector("[data-test-action='save-tip-install']")).toBeNull();
		});
	});

	describe("when the request comes from the iOS app", () => {
		it("points at the share sheet rather than an install the app already is", () => {
			const doc = panelFor(request({ userAgent: IPHONE_SAFARI, iosClient: true }));

			const variant = doc.querySelector("[data-test-save-tip-variant]");
			assert(variant, "the panel must name the client variant it rendered");
			expect(variant.getAttribute("data-test-save-tip-variant")).toBe("ios");
			expect(variant.querySelector("[data-test-action='save-tip-install']")).toBeNull();
		});
	});

	describe("the import surface", () => {
		it("warns about the links it is about to fetch, not about one article", () => {
			const doc = panelFor(request({}), ADVISORY_IMPORT);

			const title = doc.getElementById("save-tip-title");
			assert(title, "the import panel must have its own title");
			expect(title.textContent).toBe("Some of these may arrive as links only");
			expect(actionsOf(doc).getAttribute("data-test-save-tip-mode")).toBe("advisory");
			const acknowledge = doc.querySelector("[data-test-action='save-tip-acknowledge']");
			assert(acknowledge, "the import panel must offer a way to dismiss it");
			expect(acknowledge.textContent).toBe("Got it");
		});

		it("does not pretend a client could have fetched the index instead", () => {
			const text = bodyTextFor(request({}), ADVISORY_IMPORT);

			expect(text).toContain("Nothing can capture a whole index for you");
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
