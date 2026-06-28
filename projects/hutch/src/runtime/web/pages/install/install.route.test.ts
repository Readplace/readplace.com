import { firefoxS3Config } from "browser-extension-core/s3-config";
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

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
		const response = await request(harness.server).get("/install");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("should have page-install body class", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install");
		const doc = load(response.text);

		expect(doc.body.classList.contains("page-install")).toBe(true);
	});

	it("should render every client tab in order across both groups", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install");
		const doc = load(response.text);

		const tabs = Array.from(doc.querySelectorAll("[data-test-tab]")).map(
			(el) => el.getAttribute("data-test-tab"),
		);
		expect(tabs).toEqual(["firefox", "chrome", "iphone", "claude", "chatgpt"]);
	});

	it("should split tabs into a Browsers & Devices group and an AI Assistants group", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install");
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
		expect(aiTabs).toEqual(["claude", "chatgpt"]);
	});

	it("should render the group labels visibly", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install");
		const doc = load(response.text);

		const labels = Array.from(
			doc.querySelectorAll(".install-page__group-label"),
		).map((el) => el.textContent);
		expect(labels).toEqual(["Browsers & Devices", "AI Assistants"]);
	});

	it("should expose each tab group to assistive tech via role=group and aria-labelledby", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install");
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

	it("should flag exactly the iPhone tab as a beta", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install");
		const doc = load(response.text);

		const betaTabs = Array.from(doc.querySelectorAll("[data-test-tab]"))
			.filter((tab) => tab.querySelector(".install-page__tab-beta"))
			.map((tab) => tab.getAttribute("data-test-tab"));
		expect(betaTabs).toEqual(["iphone"]);

		const badge = doc.querySelector('[data-test-tab="iphone"] .install-page__tab-beta');
		expect(badge?.textContent).toBe("Beta");
	});

	it("should default to the Chrome tab and browser panel when no client param is provided", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install");
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
			"https://chromewebstore.google.com/detail/hutch/klblengmhlfnmjoagchagfcdbpbocgbf",
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

		const unavailable = doc.querySelector('[data-test-section="firefox-unavailable"]');
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

		const unavailable = doc.querySelector('[data-test-section="firefox-unavailable"]');
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

	it("should show the beta notice, TestFlight CTA, steps and outro on the iPhone panel", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=iphone");
		const doc = load(response.text);

		const notice = doc.querySelector('[data-test-section="ios-beta-notice"]');
		expect(notice?.textContent).toContain("beta");
		expect(notice?.textContent).toContain("TestFlight");

		const cta = doc.querySelector('[data-test-cta="join-ios-beta"]');
		expect(cta?.getAttribute("href")).toBe("https://testflight.apple.com/join/5eng821W");
		expect(cta?.textContent).toBe("Join the beta on TestFlight");

		expect(doc.querySelectorAll("[data-test-beta-step]")).toHaveLength(6);

		const outro = doc.querySelector('[data-test-section="ios-beta-outro"]');
		assert(outro, "iPhone beta outro must be rendered");
		expect(outro.textContent).toContain("I'll check in soon by email");
		expect(outro.textContent).toContain("feedback is welcome in-app");
	});

	it("should not load the copy-button script on non-AI panels", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const iphone = await request(harness.server).get("/install?client=iphone");
		expect(iphone.text).not.toContain(INSTALL_CLIENT_SCRIPT);

		const browser = await request(harness.server).get("/install");
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

	it("should set appropriate SEO metadata", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install");
		const doc = load(response.text);

		expect(doc.title).toContain("Install");
		const description = doc.querySelector('meta[name="description"]');
		expect(description?.getAttribute("content")).toContain("extension");
		expect(description?.getAttribute("content")).toContain("AI assistant");
	});

	it("should have SoftwareApplication and BreadcrumbList structured data", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install");
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
