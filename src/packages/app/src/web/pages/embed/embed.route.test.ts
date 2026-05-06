import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import express from "express";
import { initEmbedRoutes } from "./embed.page";

function makeApp(overrides?: { appOrigin?: string }) {
	const app = express();
	app.use("/embed", initEmbedRoutes({ appOrigin: overrides?.appOrigin ?? "https://readplace.com" }));
	return app;
}

describe("GET /embed", () => {
	it("should return 200 and HTML content", async () => {
		const response = await request(makeApp()).get("/embed");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("should render the hero title inside the embed page container", async () => {
		const response = await request(makeApp()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const page = doc.querySelector('[data-test-page="embed"]');
		assert(page, "embed page container must be rendered");
		const title = page.querySelector(".embed-page__title");
		assert(title, "hero title must be rendered");
		expect(title.textContent).toBe("A save button for your readers.");
	});

	it("should render all three variants with numeric byte counts", async () => {
		const response = await request(makeApp()).get("/embed");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.querySelectorAll("[data-test-variant]")).toHaveLength(3);

		for (const id of ["bytes-a", "bytes-b", "bytes-c"] as const) {
			const bytes = doc.querySelector(`[data-test="${id}"]`);
			assert(bytes, `${id} byte count must be rendered`);
			expect(bytes.textContent).toMatch(/^\d+ bytes$/);
		}
	});

	it("should render a URL input field inside the variants section so publishers can customise the snippets", async () => {
		const response = await request(makeApp()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const variants = doc.querySelector("#variants");
		assert(variants, "variants section must be rendered");
		const input = variants.querySelector(".embed-url-input__field");
		assert(input, "URL input must be rendered inside the variants section");
		expect(input.getAttribute("type")).toBe("url");
		expect(input.getAttribute("placeholder")).toBe("https://example.com/my-article");
	});

	it("should render every variant preview as a live anchor that passes the page URL via the save endpoint", async () => {
		const response = await request(makeApp()).get("/embed");
		const doc = new JSDOM(response.text).window.document;

		for (const id of ["preview-a", "preview-b", "preview-c"] as const) {
			const preview = doc.querySelector(`[data-test="${id}"]`);
			assert(preview, `${id} preview container must be rendered`);
			const anchor = preview.querySelector("a");
			assert(anchor, `${id} preview must contain a live anchor`);
			expect(anchor.getAttribute("href")).toContain("/save?url=");
		}
	});

	it("should render every snippet source with the canonical save URL and PAGE_URL placeholder", async () => {
		const response = await request(makeApp()).get("/embed");
		const doc = new JSDOM(response.text).window.document;

		for (const id of ["source-a", "source-b", "source-c"] as const) {
			const source = doc.querySelector(`[data-test="${id}"]`);
			assert(source, `${id} source block must be rendered`);
			expect(source.textContent).toContain("https://readplace.com/save?url=PAGE_URL");
			expect(source.textContent).toContain("https://readplace.com/embed/icon.svg");
		}
	});

	it("should render the hero demo as snippet B pointing at the embed page itself", async () => {
		const response = await request(makeApp()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const demo = doc.querySelector('[data-test="hero-demo"]');
		assert(demo, "hero demo container must be rendered");
		const anchor = demo.querySelector("a");
		assert(anchor, "hero demo must contain an anchor");
		expect(anchor.getAttribute("href")).toBe("https://readplace.com/save?url=https://readplace.com/embed/");
	});

	it("should render the quotable privacy statement", async () => {
		const response = await request(makeApp()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const privacy = doc.querySelector('[data-test="privacy-text"]');
		assert(privacy, "privacy statement must be rendered");
		expect(privacy.textContent).toContain("plain HTML link");
		expect(privacy.textContent).toContain("sets no cookies");
	});

	it("should expose a copy button for every snippet and the privacy paragraph", async () => {
		const response = await request(makeApp()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelectorAll("button[data-copy]")).toHaveLength(4);
	});

	it("should include the copy-to-clipboard inline script", async () => {
		const response = await request(makeApp()).get("/embed");
		expect(response.text).toContain("navigator.clipboard");
	});

	it("should register / with the default indexable robots directive", async () => {
		const response = await request(makeApp()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const robots = doc.querySelector('meta[name="robots"]');
		assert(robots, "robots meta must be rendered");
		expect(robots.getAttribute("content")).toBe("index, follow");
	});

	it("should substitute the Readplace app origin in live preview save links when appOrigin differs from the canonical value", async () => {
		const response = await request(makeApp({ appOrigin: "http://127.0.0.1:9999" })).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const previewAnchor = doc.querySelector('[data-test="preview-b"] a');
		assert(previewAnchor, "preview-b anchor must be rendered");
		expect(previewAnchor.getAttribute("href")).toContain("http://127.0.0.1:9999/save?url=");
	});

	it("should substitute the embed origin in live preview icon URLs so the dev server can serve them", async () => {
		const response = await request(makeApp({ appOrigin: "http://localhost:3700" })).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const previewImg = doc.querySelector('[data-test="preview-a"] img');
		assert(previewImg, "preview-a img must be rendered");
		expect(previewImg.getAttribute("src")).toBe("http://localhost:3700/embed/icon.svg");
	});

	it("should keep the canonical readplace.com URLs and PAGE_URL placeholder inside the copy-paste source blocks regardless of config", async () => {
		const response = await request(makeApp({ appOrigin: "http://127.0.0.1:9999" })).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const source = doc.querySelector('[data-test="source-b"]');
		assert(source, "source-b must be rendered");
		expect(source.textContent).toContain("https://readplace.com/save?url=PAGE_URL");
		expect(source.textContent).toContain("https://readplace.com/embed/icon.svg");
		expect(source.textContent).not.toContain("http://127.0.0.1:9999");
	});

	it("should link the footer back to the Readplace app origin", async () => {
		const response = await request(makeApp()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const link = doc.querySelector('[data-test="link-app"]');
		assert(link, "app link must be rendered");
		expect(link.getAttribute("href")).toBe("https://readplace.com");
	});
});

describe("GET /embed/preview", () => {
	it("should return 200 and HTML content", async () => {
		const response = await request(makeApp()).get("/embed/preview");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("should be marked noindex so search engines skip the developer preview", async () => {
		const response = await request(makeApp()).get("/embed/preview");
		const doc = new JSDOM(response.text).window.document;
		const robots = doc.querySelector('meta[name="robots"]');
		assert(robots, "robots meta must be rendered");
		expect(robots.getAttribute("content")).toBe("noindex, nofollow");
	});

	it("should render one stage per background", async () => {
		const response = await request(makeApp()).get("/embed/preview");
		const doc = new JSDOM(response.text).window.document;
		for (const bg of ["white", "surface", "dark"] as const) {
			const stage = doc.querySelector(`[data-test-bg="${bg}"]`);
			assert(stage, `${bg} stage must be rendered`);
		}
	});

	it("should render each variant once inside every background stage", async () => {
		const response = await request(makeApp()).get("/embed/preview");
		const doc = new JSDOM(response.text).window.document;
		const stages = doc.querySelectorAll(".embed-preview__stage");
		expect(stages).toHaveLength(3);
		for (const stage of Array.from(stages)) {
			expect(stage.querySelectorAll("a")).toHaveLength(3);
		}
	});
});

describe("GET /embed/icon.svg", () => {
	it("should return the embed icon SVG with the correct content type and immutable cache header", async () => {
		const response = await request(makeApp())
			.get("/embed/icon.svg")
			.buffer(true)
			.parse((res, cb) => {
				let data = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					data += chunk;
				});
				res.on("end", () => cb(null, data));
			});
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/image\/svg\+xml/);
		expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
		expect(response.body).toContain("<svg");
		expect(response.body).toContain('viewBox="0 0 512 512"');
	});
});
