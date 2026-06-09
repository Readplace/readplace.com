import { firefoxS3Config } from "browser-extension-core/s3-config";
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const TEST_XPI_FILENAME = "abc123-1.0.0.xpi";

function mockFirefoxAvailable() {
	jest.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
		const urlStr = url.toString();
		if (urlStr.includes("hutch-extension-prod")) {
			return new Response(TEST_XPI_FILENAME, { status: 200 });
		}
		return new Response("Not Found", { status: 404 });
	});
}

beforeEach(() => {
	mockFirefoxAvailable();
});

afterEach(() => {
	jest.restoreAllMocks();
});

const useApp = useTestServer();

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
		const doc = new JSDOM(response.text).window.document;

		expect(doc.body.classList.contains("page-install")).toBe(true);
	});

	it("should render the full ordered set of platform tabs", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install");
		const doc = new JSDOM(response.text).window.document;

		const tabs = Array.from(doc.querySelectorAll("[data-test-tab]")).map(
			(el) => el.getAttribute("data-test-tab"),
		);
		expect(tabs).toEqual(["firefox", "chrome", "iphone"]);
	});

	it("should default to Chrome tab when no client param is provided", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install");
		const doc = new JSDOM(response.text).window.document;

		const chromeTab = doc.querySelector('[data-test-tab="chrome"]');
		expect(chromeTab?.classList.contains("install-page__tab--active")).toBe(true);
		expect(chromeTab?.getAttribute("aria-current")).toBe("page");

		const firefoxTab = doc.querySelector('[data-test-tab="firefox"]');
		expect(firefoxTab?.classList.contains("install-page__tab--active")).toBe(false);
	});

	it("should respond 400 when the client query param is not a known client", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=netscape");

		expect(response.status).toBe(400);
	});

	it("should select Firefox tab when client=firefox", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=firefox");
		const doc = new JSDOM(response.text).window.document;

		const firefoxTab = doc.querySelector('[data-test-tab="firefox"]');
		expect(firefoxTab?.classList.contains("install-page__tab--active")).toBe(true);
		expect(firefoxTab?.getAttribute("aria-current")).toBe("page");

		const chromeTab = doc.querySelector('[data-test-tab="chrome"]');
		expect(chromeTab?.classList.contains("install-page__tab--active")).toBe(false);
	});

	it("should select Chrome tab when client=chrome", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = new JSDOM(response.text).window.document;

		const chromeTab = doc.querySelector('[data-test-tab="chrome"]');
		expect(chromeTab?.classList.contains("install-page__tab--active")).toBe(true);

		const firefoxTab = doc.querySelector('[data-test-tab="firefox"]');
		expect(firefoxTab?.classList.contains("install-page__tab--active")).toBe(false);
	});

	it("should render only the Firefox panel when client=firefox", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=firefox");
		const doc = new JSDOM(response.text).window.document;

		const panels = Array.from(doc.querySelectorAll("[data-test-panel]")).map(
			(el) => el.getAttribute("data-test-panel"),
		);
		expect(panels).toEqual(["firefox"]);

		const firefoxPanel = doc.querySelector('[data-test-panel="firefox"]');
		assert(firefoxPanel, "Firefox panel must be rendered");
		expect(firefoxPanel.querySelector('[data-test-cta="download-firefox"]')?.textContent).toBe("Install Readplace for Firefox");
	});

	it("should render only the Chrome panel when client=chrome", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = new JSDOM(response.text).window.document;

		const panels = Array.from(doc.querySelectorAll("[data-test-panel]")).map(
			(el) => el.getAttribute("data-test-panel"),
		);
		expect(panels).toEqual(["chrome"]);

		const chromePanel = doc.querySelector('[data-test-panel="chrome"]');
		assert(chromePanel, "Chrome panel must be rendered");
		expect(chromePanel.querySelector('[data-test-cta="download-chrome"]')?.textContent).toBe("Install Readplace for Chrome");
	});

	it("should render the Firefox download button linking to the S3 XPI", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=firefox");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector(
			'[data-test-cta="download-firefox"]',
		);
		expect(cta?.getAttribute("href")).toBe(firefoxS3Config.getExtensionDownloadUrl({ stage: "prod", filename: TEST_XPI_FILENAME }));
	});

	it("should render the Chrome download button linking to the Chrome Web Store", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=chrome");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector(
			'[data-test-cta="download-chrome"]',
		);
		expect(cta?.getAttribute("href")).toBe("https://chromewebstore.google.com/detail/hutch/klblengmhlfnmjoagchagfcdbpbocgbf");
		expect(cta?.textContent).toBe("Install Readplace for Chrome");
	});

	it("should set appropriate SEO metadata", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.title).toContain("Install");
		const description = doc.querySelector('meta[name="description"]');
		expect(description?.getAttribute("content")).toContain("extension");
	});

	it("should have SoftwareApplication and BreadcrumbList structured data", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install");
		const doc = new JSDOM(response.text).window.document;

		const scripts = doc.querySelectorAll(
			'script[type="application/ld+json"]',
		);
		const schemas = Array.from(scripts).map((s) =>
			JSON.parse(s.textContent ?? "{}"),
		);
		const software = schemas.find(
			(s: { "@type": string }) => s["@type"] === "SoftwareApplication",
		);
		expect(software).toBeDefined();
		expect(software.applicationCategory).toBe("BrowserApplication");
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

	it("should show Firefox unavailable message when Firefox latest.txt returns 404", async () => {
		jest.restoreAllMocks();
		jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
			return new Response("Not Found", { status: 404 });
		});

		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=firefox");
		const doc = new JSDOM(response.text).window.document;

		const unavailable = doc.querySelector('[data-test-section="firefox-unavailable"]');
		expect(unavailable?.textContent).toBe(
			"The Firefox extension is not available for download yet. Please check back soon.",
		);
	});

	it("should show Firefox unavailable message when latest.txt returns empty body", async () => {
		jest.restoreAllMocks();
		jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
			return new Response("", { status: 200 });
		});

		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=firefox");
		const doc = new JSDOM(response.text).window.document;

		const unavailable = doc.querySelector('[data-test-section="firefox-unavailable"]');
		expect(unavailable?.textContent).toBe(
			"The Firefox extension is not available for download yet. Please check back soon.",
		);
	});

	it("should link tabs to the correct URLs", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=firefox");
		const doc = new JSDOM(response.text).window.document;

		const firefoxTab = doc.querySelector('[data-test-tab="firefox"]');
		expect(firefoxTab?.getAttribute("href")).toBe("/install?client=firefox&utm_source=install-tabs&utm_medium=internal&utm_content=firefox");

		const chromeTab = doc.querySelector('[data-test-tab="chrome"]');
		expect(chromeTab?.getAttribute("href")).toBe("/install?client=chrome&utm_source=install-tabs&utm_medium=internal&utm_content=chrome");
	});

	it("should render an iPhone tab linking to the iPhone panel on every view", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install");
		const doc = new JSDOM(response.text).window.document;

		const iphoneTab = doc.querySelector('[data-test-tab="iphone"]');
		expect(iphoneTab?.getAttribute("href")).toBe("/install?client=iphone&utm_source=install-tabs&utm_medium=internal&utm_content=iphone");
		expect(iphoneTab?.textContent).toBe("iPhone");
		expect(iphoneTab?.classList.contains("install-page__tab--active")).toBe(false);
	});

	it("should select the iPhone tab when client=iphone", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=iphone");
		const doc = new JSDOM(response.text).window.document;

		const iphoneTab = doc.querySelector('[data-test-tab="iphone"]');
		expect(iphoneTab?.classList.contains("install-page__tab--active")).toBe(true);
		expect(iphoneTab?.getAttribute("aria-current")).toBe("page");

		const chromeTab = doc.querySelector('[data-test-tab="chrome"]');
		expect(chromeTab?.classList.contains("install-page__tab--active")).toBe(false);
	});

	it("should render only the iPhone panel explaining the share-sheet save when client=iphone", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=iphone");
		const doc = new JSDOM(response.text).window.document;

		const panels = Array.from(doc.querySelectorAll("[data-test-panel]")).map(
			(el) => el.getAttribute("data-test-panel"),
		);
		expect(panels).toEqual(["iphone"]);

		const iphonePanel = doc.querySelector('[data-test-panel="iphone"]');
		assert(iphonePanel, "iPhone panel must be rendered");
		expect(iphonePanel.textContent).toContain("share");
	});

	it("should show the beta notice on the iPhone tab", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=iphone");
		const doc = new JSDOM(response.text).window.document;

		const notice = doc.querySelector('[data-test-section="ios-beta-notice"]');
		expect(notice?.textContent).toContain("beta");
		expect(notice?.textContent).toContain("TestFlight");
	});

	it("should link the Join the beta button to TestFlight", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=iphone");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector('[data-test-cta="join-ios-beta"]');
		expect(cta?.getAttribute("href")).toBe("https://testflight.apple.com/join/5eng821W");
		expect(cta?.textContent).toBe("Join the beta on TestFlight");
	});

	it("should list the beta setup steps on the iPhone tab", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/install?client=iphone");
		const doc = new JSDOM(response.text).window.document;

		const steps = doc.querySelectorAll("[data-test-beta-step]");
		expect(steps).toHaveLength(6);

		const stepsText = doc.querySelector('[data-test-section="ios-beta-steps"]')?.textContent ?? "";
		expect(stepsText).toContain("TestFlight");
		expect(stepsText).toContain("Share");
		expect(stepsText).toContain("readplace.com");
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
});
