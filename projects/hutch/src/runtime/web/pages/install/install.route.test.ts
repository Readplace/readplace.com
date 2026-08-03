import { firefoxS3Config } from "browser-extension-core/s3-config";
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { BROWSER_REQUEST_HEADERS, useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { SUPPORTED_CLIENTS } from "@packages/supported-clients";

const TEST_XPI_FILENAME = "abc123-1.0.0.xpi";
const INSTALL_CLIENT_SCRIPT = "/client-dist/install.client.js";

let fetchSpy: jest.SpyInstance;

function mockFirefoxAvailable(): jest.SpyInstance {
	return jest.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
		const urlStr = url.toString();
		if (urlStr.includes("hutch-extension-prod")) {
			return new Response(TEST_XPI_FILENAME, { status: 200 });
		}
		return new Response("Not Found", { status: 404 });
	});
}

beforeEach(() => {
	fetchSpy = mockFirefoxAvailable();
});

afterEach(() => {
	jest.restoreAllMocks();
});

const useApp = useTestServer();

function load(text: string): Document {
	return new JSDOM(text).window.document;
}

describe("GET /install", () => {
	it("should return 200 and HTML content", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("should have page-install body class", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = load(response.text);

		expect(doc.body.classList.contains("page-install")).toBe(true);
	});

	it("should render every client tab in order across both groups", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = load(response.text);

		const tabs = Array.from(doc.querySelectorAll("[data-test-tab]")).map(
			(el) => el.getAttribute("data-test-tab"),
		);
		expect(tabs).toEqual(["firefox", "chrome", "iphone", "chatgpt", "gemini", "claude"]);
	});

	it("should split tabs into a Browsers & Devices group and an AI Assistants group", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = load(response.text);

		const groups = Array.from(doc.querySelectorAll("[data-test-group]")).map(
			(el) => el.getAttribute("data-test-group"),
		);
		expect(groups).toEqual(["browsers", "ai"]);

		const devices = doc.querySelector('[data-test-group="browsers"]');
		assert(devices, "browsers group must render");
		const deviceTabs = Array.from(devices.querySelectorAll("[data-test-tab]")).map(
			(el) => el.getAttribute("data-test-tab"),
		);
		expect(deviceTabs).toEqual(["firefox", "chrome", "iphone"]);

		const ai = doc.querySelector('[data-test-group="ai"]');
		assert(ai, "ai group must render");
		const aiTabs = Array.from(ai.querySelectorAll("[data-test-tab]")).map(
			(el) => el.getAttribute("data-test-tab"),
		);
		expect(aiTabs).toEqual(["chatgpt", "gemini", "claude"]);
	});

	it("should render the group labels visibly", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = load(response.text);

		const labels = Array.from(
			doc.querySelectorAll(".install-page__group-label"),
		).map((el) => el.textContent);
		expect(labels).toEqual(["Browsers & Devices", "AI Assistants"]);
	});

	it("should expose each tab group to assistive tech via role=group and aria-labelledby", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = load(response.text);

		const groups = Array.from(doc.querySelectorAll("[data-test-group]"));
		expect(groups).toHaveLength(2);
		for (const group of groups) {
			expect(group.getAttribute("role")).toBe("group");
			const labelledBy = group.getAttribute("aria-labelledby");
			assert(labelledBy, "each group must reference its label via aria-labelledby");
			const label = doc.getElementById(labelledBy);
			assert(label, "aria-labelledby must resolve to the group's label element");
			expect(label).toBe(group.querySelector(".install-page__group-label"));
		}
	});

	it("should label every tab with exactly its display name and no status chip", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = load(response.text);

		for (const client of SUPPORTED_CLIENTS) {
			const tab = doc.querySelector(`[data-test-tab="${client.name}"]`);
			assert(tab, `tab ${client.name} must render`);
			expect(tab.textContent).toBe(client.displayName);
		}
	});

	it("should render a decorative brand icon inside every tab", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = load(response.text);

		const tabs = Array.from(doc.querySelectorAll("[data-test-tab]"));
		expect(tabs).toHaveLength(6);
		for (const tab of tabs) {
			const icon = tab.querySelector(".install-page__tab-icon svg");
			assert(icon, `tab ${tab.getAttribute("data-test-tab")} must render an inline icon`);
			expect(icon.getAttribute("aria-hidden")).toBe("true");
			expect(icon.getAttribute("focusable")).toBe("false");
			assert(icon.querySelector("path"), "the icon must carry path geometry");
		}
	});

	it("should keep tab icons free of text so the label is the tab's whole accessible name", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = load(response.text);

		expect(doc.querySelector('[data-test-tab="chrome"]')?.textContent).toBe("Chrome");
		expect(doc.querySelector('[data-test-tab="claude"]')?.textContent).toBe("Claude");
		expect(doc.querySelector('[data-test-tab="iphone"]')?.textContent).toBe("iPhone");
	});

	it("should select the Chrome tab and browser panel when client=chrome", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = load(response.text);

		const chromeTab = doc.querySelector('[data-test-tab="chrome"]');
		expect(chromeTab?.classList.contains("install-page__tab--active")).toBe(true);
		expect(chromeTab?.getAttribute("aria-current")).toBe("page");

		const firefoxTab = doc.querySelector('[data-test-tab="firefox"]');
		expect(firefoxTab?.classList.contains("install-page__tab--active")).toBe(false);

		const panels = Array.from(doc.querySelectorAll("[data-test-panel]")).map(
			(el) => el.getAttribute("data-test-panel"),
		);
		expect(panels).toEqual(["browser"]);
		expect(doc.querySelector('[data-test-cta="download-chrome"]')?.textContent).toBe(
			"Install Readplace for Chrome",
		);
	});

	it("should respond 400 when the client query param is not a known client", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=netscape");

		expect(response.status).toBe(400);
	});

	it("should select the Firefox tab and browser panel when client=firefox", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=firefox");
		const doc = load(response.text);

		const firefoxTab = doc.querySelector('[data-test-tab="firefox"]');
		expect(firefoxTab?.classList.contains("install-page__tab--active")).toBe(true);
		expect(firefoxTab?.getAttribute("aria-current")).toBe("page");

		const panels = Array.from(doc.querySelectorAll("[data-test-panel]")).map(
			(el) => el.getAttribute("data-test-panel"),
		);
		expect(panels).toEqual(["browser"]);
		expect(
			doc.querySelector('[data-test-cta="download-firefox"]')?.textContent,
		).toBe("Install Readplace for Firefox");
	});

	it("should select the Chrome tab and browser panel when client=chrome", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = load(response.text);

		const chromeTab = doc.querySelector('[data-test-tab="chrome"]');
		expect(chromeTab?.classList.contains("install-page__tab--active")).toBe(true);

		const firefoxTab = doc.querySelector('[data-test-tab="firefox"]');
		expect(firefoxTab?.classList.contains("install-page__tab--active")).toBe(false);

		const cta = doc.querySelector('[data-test-cta="download-chrome"]');
		expect(cta?.getAttribute("href")).toBe(
			"https://chromewebstore.google.com/detail/readplace-%E2%80%94-save-articles/klblengmhlfnmjoagchagfcdbpbocgbf",
		);
	});

	it("should render the Firefox download button linking to the S3 XPI", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=firefox");
		const doc = load(response.text);

		const cta = doc.querySelector('[data-test-cta="download-firefox"]');
		expect(cta?.getAttribute("href")).toBe(
			firefoxS3Config.getExtensionDownloadUrl({ stage: "prod", filename: TEST_XPI_FILENAME }),
		);
	});

	it("should not request the Firefox latest-pointer on non-firefox panels", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await request(harness.server).get("/install?client=claude");

		const requestedFirefoxPointer = fetchSpy.mock.calls.some(([url]) =>
			String(url).includes("hutch-extension-prod"),
		);
		expect(requestedFirefoxPointer).toBe(false);
	});

	it("should list the browser setup steps on a browser panel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = load(response.text);

		const steps = doc.querySelectorAll("[data-test-browser-step]");
		expect(steps).toHaveLength(3);
		const stepsText =
			doc.querySelector('[data-test-section="browser-steps"]')?.textContent ?? "";
		expect(stepsText).toContain("Sign in once");
		expect(stepsText).toContain("Ctrl/Cmd+D");
	});

	it("should show the Firefox unavailable message when Firefox latest.txt returns 404", async () => {
		jest.restoreAllMocks();
		jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
			return new Response("Not Found", { status: 404 });
		});

		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=firefox");
		const doc = load(response.text);

		const unavailable = doc.querySelector('[data-test-section="browser-unavailable"]');
		expect(unavailable?.textContent).toBe(
			"The Firefox extension is not available for download yet. Please check back soon.",
		);
		expect(doc.querySelector('[data-test-cta="download-firefox"]')).toBeNull();
	});

	it("should show the Firefox unavailable message when latest.txt returns empty body", async () => {
		jest.restoreAllMocks();
		jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
			return new Response("", { status: 200 });
		});

		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=firefox");
		const doc = load(response.text);

		const unavailable = doc.querySelector('[data-test-section="browser-unavailable"]');
		expect(unavailable?.textContent).toBe(
			"The Firefox extension is not available for download yet. Please check back soon.",
		);
	});

	it("should link tabs to their client URLs with internal tracking", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=firefox");
		const doc = load(response.text);

		expect(doc.querySelector('[data-test-tab="firefox"]')?.getAttribute("href")).toBe(
			"/install?client=firefox&utm_source=install-tabs&utm_medium=internal&utm_content=firefox",
		);
		expect(doc.querySelector('[data-test-tab="claude"]')?.getAttribute("href")).toBe(
			"/install?client=claude&utm_source=install-tabs&utm_medium=internal&utm_content=claude",
		);
	});

	it("should select the iPhone tab and panel when client=iphone", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=iphone");
		const doc = load(response.text);

		const iphoneTab = doc.querySelector('[data-test-tab="iphone"]');
		expect(iphoneTab?.classList.contains("install-page__tab--active")).toBe(true);
		expect(iphoneTab?.getAttribute("aria-current")).toBe("page");

		const panels = Array.from(doc.querySelectorAll("[data-test-panel]")).map(
			(el) => el.getAttribute("data-test-panel"),
		);
		expect(panels).toEqual(["iphone"]);
		expect(doc.querySelector('[data-test-panel="iphone"]')?.textContent).toContain("share");
	});

	it("should show the App Store CTA, setup steps and outro on the iPhone panel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=iphone");
		const doc = load(response.text);

		const cta = doc.querySelector('[data-test-cta="download-iphone"]');
		expect(cta?.getAttribute("href")).toBe("https://apps.apple.com/app/readplace/id6777107238");
		expect(cta?.textContent).toBe("Install Readplace for iPhone");

		const steps = doc.querySelector('[data-test-section="ios-setup-steps"]');
		assert(steps, "iPhone setup steps must be rendered");
		expect(doc.querySelectorAll("[data-test-ios-step]")).toHaveLength(3);
		expect(steps.textContent).toContain("Share to Readplace");
		expect(steps.textContent).toContain("Favourites");

		const outro = doc.querySelector('[data-test-section="ios-setup-outro"]');
		assert(outro, "iPhone setup outro must be rendered");
		expect(outro.textContent).toContain("feedback is welcome in-app");
	});

	it("should offer Safari's Smart App Banner, so an iPhone visitor gets the native install prompt", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=iphone");
		const doc = load(response.text);

		expect(doc.querySelector('meta[name="apple-itunes-app"]')?.getAttribute("content")).toBe(
			"app-id=6777107238",
		);
	});

	it("should describe the iPhone app as a MobileApplication installed from the App Store", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=iphone");
		const doc = load(response.text);

		const schemas = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map(
			(script) => JSON.parse(script.textContent ?? "{}"),
		);
		const app = schemas.find((schema) => schema["@type"] === "MobileApplication");
		assert(app, "the iPhone panel must publish a MobileApplication entity");
		expect(app.operatingSystem).toBe("iOS, macOS");
		expect(app.installUrl).toBe("https://apps.apple.com/app/readplace/id6777107238");
	});

	it("should not load the copy-button script on non-AI panels", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const iphone = await request(harness.server).get("/install?client=iphone");
		expect(iphone.text).not.toContain(INSTALL_CLIENT_SCRIPT);

		const browser = await request(harness.server).get("/install?client=chrome");
		expect(browser.text).not.toContain(INSTALL_CLIENT_SCRIPT);
	});

	it("should select the Claude tab and AI panel when client=claude", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=claude");
		const doc = load(response.text);

		const claudeTab = doc.querySelector('[data-test-tab="claude"]');
		expect(claudeTab?.classList.contains("install-page__tab--active")).toBe(true);
		expect(claudeTab?.getAttribute("aria-current")).toBe("page");

		const panels = Array.from(doc.querySelectorAll("[data-test-panel]")).map(
			(el) => el.getAttribute("data-test-panel"),
		);
		expect(panels).toEqual(["ai"]);
	});

	it("should show the MCP server URL and full-setup-guide link on an AI panel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=claude");
		const doc = load(response.text);

		const serverUrl = doc.querySelector(
			'[data-test-section="ai-server-url"] .install-page__server-url-value',
		);
		expect(serverUrl?.textContent).toBe("https://readplace.com/mcp");

		const guide = doc.querySelector('[data-test-cta="ai-full-guide"]');
		expect(guide?.getAttribute("href")).toBe("/mcp");
	});

	it("should show the Claude connect prompt and copy buttons hidden by default", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=claude");
		const doc = load(response.text);

		const prompt = doc.querySelector(
			'[data-test-section="ai-prompt"] .install-page__prompt-text',
		);
		expect(prompt?.textContent).toBe(
			"Add readplace.com/mcp as a connector so you can save pages to and read my reading list.",
		);

		const copyButtons = Array.from(doc.querySelectorAll("[data-install-copy]"));
		expect(copyButtons).toHaveLength(2);
		for (const button of copyButtons) {
			expect(button.hasAttribute("hidden")).toBe(true);
		}
		const copyTargets = copyButtons.map((b) => b.getAttribute("data-install-text"));
		expect(copyTargets).toContain("https://readplace.com/mcp");
	});

	it("should load the copy-button script on an AI panel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=claude");

		expect(response.text).toContain(INSTALL_CLIENT_SCRIPT);
	});

	it("should target the rendered AI copy buttons with the selectors its built bundle wires", async () => {
		const bundleSource = readFileSync(
			join(__dirname, "..", "..", "client-dist", "install.client.js"),
			"utf-8",
		);
		const copySelector = bundleSource.match(/copySelector:\s*'([^']+)'/)?.[1];
		const textAttr = bundleSource.match(/textAttr:\s*'([^']+)'/)?.[1];
		assert(copySelector, "the install bundle footer must wire a copySelector");
		assert(textAttr, "the install bundle footer must wire a textAttr");

		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=claude");
		const doc = load(response.text);

		const targeted = Array.from(doc.querySelectorAll(copySelector));
		expect(targeted).toHaveLength(2);
		for (const button of targeted) {
			assert(button.hasAttribute(textAttr), `copy button must carry ${textAttr}`);
		}
	});

	it("should show ChatGPT-specific copy on the ChatGPT AI panel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chatgpt");
		const doc = load(response.text);

		const chatgptTab = doc.querySelector('[data-test-tab="chatgpt"]');
		expect(chatgptTab?.classList.contains("install-page__tab--active")).toBe(true);

		expect(doc.querySelector('[data-test-panel="ai"] .install-page__panel-title')?.textContent).toBe(
			"Connect Readplace to ChatGPT",
		);
		expect(
			doc.querySelector('[data-test-section="ai-prompt"] .install-page__prompt-text')?.textContent,
		).toBe("Connect to readplace.com so you can save pages to and read my reading list.");
	});

	it("should show the Gemini CLI command on the Gemini AI panel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=gemini");
		const doc = load(response.text);

		const geminiTab = doc.querySelector('[data-test-tab="gemini"]');
		expect(geminiTab?.classList.contains("install-page__tab--active")).toBe(true);

		expect(doc.querySelector('[data-test-panel="ai"] .install-page__panel-title')?.textContent).toBe(
			"Connect Readplace to Gemini",
		);
		expect(
			doc.querySelector('[data-test-section="ai-prompt"] .install-page__prompt-label')?.textContent,
		).toBe("Run this once");
		expect(
			doc.querySelector('[data-test-section="ai-prompt"] .install-page__prompt-text')?.textContent,
		).toBe("gemini mcp add --transport http readplace https://readplace.com/mcp");
	});

	it("should land client=ai on the Claude tab as a convenience alias", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=ai");
		const doc = load(response.text);

		const claudeTab = doc.querySelector('[data-test-tab="claude"]');
		expect(claudeTab?.classList.contains("install-page__tab--active")).toBe(true);

		const panels = Array.from(doc.querySelectorAll("[data-test-panel]")).map(
			(el) => el.getAttribute("data-test-panel"),
		);
		expect(panels).toEqual(["ai"]);
	});

	it("should render the browser screenshots with captions on the chrome panel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = load(response.text);

		const shots = Array.from(doc.querySelectorAll("[data-test-screenshot]"));
		expect(shots).toHaveLength(3);

		const images = shots.map((shot) => shot.querySelector("img"));
		expect(images.map((img) => img?.getAttribute("src"))).toEqual([
			"https://static.test/screenshots/save-from-extension.webp",
			"https://static.test/screenshots/queue.webp",
			"https://static.test/screenshots/reader-tldr.webp",
		]);
		for (const img of images) {
			assert(img, "each screenshot figure must contain an image");
			expect(img.getAttribute("loading")).toBe("lazy");
			expect(img.getAttribute("width")).toBe("1440");
			expect(img.getAttribute("height")).toBe("900");
			assert(img.getAttribute("alt"), "each screenshot must carry alt text");
		}

		const captions = shots.map((shot) => shot.querySelector("figcaption")?.textContent);
		expect(captions[0]).toBe("One click saves the full page you're reading — not just the link.");
		expect(captions[2]).toBe("Read without the clutter — with a TL;DR before you commit.");

		for (const shot of shots) {
			expect(shot.classList.contains("install-page__screenshot--wide")).toBe(true);
		}
	});

	it("should render the same screenshots on the firefox panel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=firefox");
		const doc = load(response.text);

		expect(doc.querySelectorAll("[data-test-screenshot]")).toHaveLength(3);
	});

	it("should render the iPhone screenshots as portrait shots sharing a row", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=iphone");
		const doc = load(response.text);

		const shots = Array.from(doc.querySelectorAll("[data-test-screenshot]"));
		expect(shots).toHaveLength(6);
		expect(
			shots.map((shot) => shot.querySelector("img")?.getAttribute("src")),
		).toEqual([
			"https://static.test/screenshots/ios-share-sheet.webp",
			"https://static.test/screenshots/ios-reading-list.webp",
			"https://static.test/screenshots/ios-reader.webp",
			"https://static.test/screenshots/ios-share-more.webp",
			"https://static.test/screenshots/ios-share-favourite.webp",
			"https://static.test/screenshots/ios-share-pinned.webp",
		]);
		for (const shot of shots) {
			expect(shot.classList.contains("install-page__screenshot--tall")).toBe(true);
		}
	});

	it("should not render screenshots on AI panels", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		for (const client of ["chatgpt", "gemini", "claude"]) {
			const response = await request(harness.server).get(`/install?client=${client}`);
			const doc = load(response.text);
			expect(doc.querySelectorAll("[data-test-screenshot]")).toHaveLength(0);
		}
	});

	it("should point og:image at the install social card", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = load(response.text);

		const ogImage = doc.querySelector('meta[property="og:image"]');
		expect(ogImage?.getAttribute("content")).toBe(
			"https://static.test/screenshots/og-install-1200x630.png",
		);
	});

	it("should set appropriate SEO metadata", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = load(response.text);

		expect(doc.title).toContain("Install");
		const description = doc.querySelector('meta[name="description"]');
		expect(description?.getAttribute("content")).toContain("extension");
		expect(description?.getAttribute("content")).toContain("AI assistant");
	});

	it("should have SoftwareApplication and BreadcrumbList structured data", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = load(response.text);

		const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
		const schemas = Array.from(scripts).map((s) => JSON.parse(s.textContent ?? "{}"));
		const software = schemas.find(
			(s: { "@type": string }) => s["@type"] === "SoftwareApplication",
		);
		expect(software).toBeDefined();
		expect(software.applicationCategory).toBe("ProductivityApplication");
		expect(software.offers.price).toBe("0");

		const breadcrumb = schemas.find(
			(s: { "@type": string }) => s["@type"] === "BreadcrumbList",
		);
		expect(breadcrumb).toBeDefined();
		expect(breadcrumb.itemListElement).toEqual([
			{
				"@type": "ListItem",
				position: 1,
				name: "Home",
				item: "https://readplace.com/",
			},
			{
				"@type": "ListItem",
				position: 2,
				name: "Install",
				item: "https://readplace.com/install",
			},
		]);
	});

	it("returns markdown when Accept: text/markdown is sent", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/install")
			.set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(response.text).toMatch(/^# /);
		expect(response.text).not.toContain("<script");
	});

	it("does not leak tab icon markup or geometry into a markdown response", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/install")
			.set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.text).toContain("Chrome");
		expect(response.text).not.toContain("<svg");
		expect(response.text).not.toContain("currentColor");
		expect(response.text).not.toContain("viewBox");
	});

	it("does not leak the AI copy-button script into a markdown response", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/install?client=claude")
			.set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(response.text).not.toContain("<script");
	});
});

describe("GET /install client detection", () => {
	const MACOS_FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0";
	const WINDOWS_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0";
	const MACOS_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
	const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
	const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
	const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.0.0 Mobile/15E148 Safari/604.1";
	const IPHONE_FIREFOX = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15";
	const IPHONE_EDGE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/125.0.0.0 Mobile/15E148 Safari/605.1.15";
	const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
	const ANDROID_FIREFOX = "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0";
	const MACOS_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
	const IPAD_SAFARI = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
	const GOOGLEBOT = "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

	async function landingClient(userAgent: string): Promise<string | undefined> {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install").set("User-Agent", userAgent);
		expect(response.status).toBe(302);
		return response.headers.location;
	}

	it("sends desktop Firefox to the Firefox tab on every OS, because the Chrome default offers a store Firefox cannot install from", async () => {
		expect(await landingClient(MACOS_FIREFOX)).toBe("/install?client=firefox");
		expect(await landingClient(WINDOWS_FIREFOX)).toBe("/install?client=firefox");
	});

	it("sends desktop Chrome to the Chrome tab on every OS, because that is the one store its extension ships through", async () => {
		expect(await landingClient(MACOS_CHROME)).toBe("/install?client=chrome");
		expect(await landingClient(WINDOWS_CHROME)).toBe("/install?client=chrome");
	});

	it("sends every iPhone browser to the iPhone app, because iOS forbids extensions outright so no browser there can install one", async () => {
		expect(await landingClient(IPHONE_SAFARI)).toBe("/install?client=iphone");
		expect(await landingClient(IPHONE_CHROME)).toBe("/install?client=iphone");
		expect(await landingClient(IPHONE_FIREFOX)).toBe("/install?client=iphone");
		expect(await landingClient(IPHONE_EDGE)).toBe("/install?client=iphone");
	});

	it("sends Android to Gemini, because Android has neither an app nor an extension yet and Gemini is already on the device", async () => {
		expect(await landingClient(ANDROID_CHROME)).toBe("/install?client=gemini");
		expect(await landingClient(ANDROID_FIREFOX)).toBe("/install?client=gemini");
	});

	it("sends any browser with no first-party client to ChatGPT, because the MCP connector is the only route open to it", async () => {
		expect(await landingClient(MACOS_SAFARI)).toBe("/install?client=chatgpt");
		expect(await landingClient(IPAD_SAFARI)).toBe("/install?client=chatgpt");
	});

	it("carries the campaign params through the hop, because dropping them would erase the attribution of the warmest links into this page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/install?utm_source=web-app&utm_medium=banner&utm_campaign=extension-suggestion")
			.set("User-Agent", MACOS_FIREFOX);

		expect(response.headers.location).toBe(
			"/install?utm_source=web-app&utm_medium=banner&utm_campaign=extension-suggestion&client=firefox",
		);
	});

	it("varies on User-Agent, because one browser's answer must never be served from cache to another", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install").set("User-Agent", MACOS_FIREFOX);

		expect(response.headers.vary).toBe("Accept, User-Agent");
	});

	it("answers a crawler at the canonical URL instead of redirecting it, because Googlebot carries a Chrome token and the sitemap submits this exact URL", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install").set("User-Agent", GOOGLEBOT);
		const doc = load(response.text);

		const chromeTab = doc.querySelector('[data-test-tab="chrome"]');
		assert(chromeTab, "the chrome tab must render for a crawler");
		expect(response.status).toBe(200);
		expect(chromeTab.classList.contains("install-page__tab--active")).toBe(true);
	});

	it("keeps serving markdown to an agent that asked for it, because a redirect ahead of negotiation would break every MCP client", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/install")
			.set("User-Agent", MACOS_FIREFOX)
			.set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
	});

	it("honours an explicit client param over the detected one, because a shared link must land where its sender intended", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/install?client=chrome")
			.set("User-Agent", MACOS_FIREFOX);
		const doc = load(response.text);

		const chromeTab = doc.querySelector('[data-test-tab="chrome"]');
		assert(chromeTab, "the chrome tab must render");
		expect(response.status).toBe(200);
		expect(chromeTab.classList.contains("install-page__tab--active")).toBe(true);
	});

	it("still rejects an unknown client, because detection must not turn a 400 into a redirect", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/install?client=netscape")
			.set("User-Agent", MACOS_FIREFOX);

		expect(response.status).toBe(400);
	});

	it("counts one internal click across the hop, because the redirect and the page it lands on both carry utm_medium=internal", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const firefoxBrowser = { ...BROWSER_REQUEST_HEADERS, "User-Agent": MACOS_FIREFOX };
		const hop = await request(harness.server)
			.get("/install?utm_source=header-nav&utm_medium=internal&utm_content=install")
			.set(firefoxBrowser);
		await request(harness.server).get(hop.headers.location).set(firefoxBrowser);

		const clicks = harness.analytics.events.filter((event) => event.event === "click");
		expect(clicks).toHaveLength(1);
	});
});
