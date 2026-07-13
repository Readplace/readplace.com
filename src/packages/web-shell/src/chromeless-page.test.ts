import { JSDOM } from "jsdom";
import { initChromelessPage } from "./chromeless-page";
import type { PageBody } from "./page-body.types";

const ChromelessPage = initChromelessPage({ staticBaseUrl: "https://static.example", liveReload: false });

function createTestPageBody(overrides: Partial<PageBody> = {}): PageBody {
	return {
		seo: {
			title: "Reader",
			description: "An article",
			canonicalUrl: "https://readplace.com/queue/abc/view",
			robots: "noindex, nofollow",
		},
		styles: ".reader { color: rebeccapurple; }",
		content: { html: "<main class=\"reader\"><p>Body copy.</p></main>" },
		scripts: "<script src=\"/client-dist/progress-bar.client.js\" defer></script>",
		...overrides,
	};
}

describe("ChromelessPage", () => {
	it("renders the page <main>, its styles, and htmx — with none of the web shell chrome", () => {
		const result = ChromelessPage(createTestPageBody()).to("text/html");

		expect(result.statusCode).toBe(200);
		const doc = new JSDOM(result.body).window.document;

		const main = doc.querySelector("main.reader");
		expect(main?.querySelector("p")?.textContent).toBe("Body copy.");
		expect(main?.querySelector("style")?.textContent).toContain("rebeccapurple");
		expect(doc.querySelector('script[src*="/client-dist/progress-bar.client.js"]')).not.toBeNull();
		expect(doc.querySelector('script[src*="htmx.org"]')).not.toBeNull();

		expect(doc.querySelector(".header")).toBeNull();
		expect(doc.querySelector(".nav")).toBeNull();
		expect(doc.querySelector(".footer")).toBeNull();
		expect(doc.querySelector(".banner-area")).toBeNull();
	});

	it("carries the page's seo title, description, and robots into <head>", () => {
		const doc = new JSDOM(ChromelessPage(createTestPageBody()).to("text/html").body).window.document;
		expect(doc.title).toBe("Reader");
		expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, nofollow");
		expect(doc.querySelector('meta[name="description"]')?.getAttribute("content")).toBe("An article");
	});

	it("honours the PageBody status code", () => {
		const result = ChromelessPage(createTestPageBody({ statusCode: 404 })).to("text/html");
		expect(result.statusCode).toBe(404);
	});

	it("renders without scripts when the page declares none", () => {
		const doc = new JSDOM(
			ChromelessPage(createTestPageBody({ scripts: undefined })).to("text/html").body,
		).window.document;
		expect(doc.querySelector('script[src*="htmx.org"]')).not.toBeNull();
		expect(doc.querySelector('script[src*="/client-dist/"]')).toBeNull();
	});

	it("injects the dev livereload script only when liveReload is enabled", () => {
		const live = initChromelessPage({ staticBaseUrl: "https://static.example", liveReload: true });
		const doc = new JSDOM(live(createTestPageBody()).to("text/html").body).window.document;
		expect(doc.querySelector('script[src*="livereload.js"]')).not.toBeNull();
	});

	it("appends the site's own scripts after the page's, so a chromeless page still gets what the whole site relies on", () => {
		const withSite = initChromelessPage({
			staticBaseUrl: "https://static.example",
			liveReload: true,
			siteScripts: `<script src="/client-dist/local-time.client.js" defer></script>`,
		});

		const body = withSite(createTestPageBody()).to("text/html").body;
		const doc = new JSDOM(body).window.document;
		expect(doc.querySelector('script[src*="/client-dist/local-time.client.js"]')).not.toBeNull();

		const order = Array.from(doc.querySelectorAll("script"))
			.map((script) => script.getAttribute("src") ?? "")
			.filter((src) => src.length > 0);
		const page = order.findIndex((src) => src.includes("progress-bar.client.js"));
		const site = order.findIndex((src) => src.includes("local-time.client.js"));
		const liveReload = order.findIndex((src) => src.includes("livereload.js"));
		expect(page).toBeLessThan(site);
		expect(site).toBeLessThan(liveReload);
	});
});
