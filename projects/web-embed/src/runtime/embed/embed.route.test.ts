import assert from "node:assert/strict";
import type { Server } from "node:http";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import { initBase, GlobalNav, HtmxOmitted } from "@packages/web-shell";
import type { ResolveLogin } from "@packages/web-session";
import { JSDOM } from "jsdom";
import request from "supertest";
import express from "express";
import { initEmbedRoutes } from "./embed.page";
import { PAGE_URL_PLACEHOLDER, SNIPPET_VARIANTS, byteLength, renderCanonicalSnippet } from "./snippet.component";

const servers: Server[] = [];
afterEach(async () => {
	/** server.close only errors when the socket was never bound, which can't
	 * happen here because makeServer always returns from listen(0). Ignore the
	 * err arg so coverage doesn't carry a phantom reject branch. */
	await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

/** Every reader resolves to guest unless a test injects a different resolver. */
const guestResolver: ResolveLogin = async () => ({ isAuthenticated: false });

/** Resolves the canonical `hutch_sid=valid` cookie to an authenticated reader,
 * everything else to guest — the seam that drives the authenticated-nav test
 * without standing up a real session store (DI, not mocks). */
const authedResolver: ResolveLogin = async (cookieHeader) =>
	cookieHeader === "hutch_sid=valid"
		? { isAuthenticated: true, userId: authenticatedUserIdFrom("user-1"), emailVerified: true, sessionExpiresAt: 1_800_000_000 }
		: { isAuthenticated: false };

function makeServer(overrides?: { appOrigin?: string; resolveLogin?: ResolveLogin }): Server {
	const app = express();
	const base = initBase({ staticBaseUrl: "", liveReload: false, renderNav: GlobalNav, htmx: HtmxOmitted });
	app.use(
		"/embed",
		initEmbedRoutes({
			appOrigin: overrides?.appOrigin ?? "https://readplace.com",
			base,
			resolveLogin: overrides?.resolveLogin ?? guestResolver,
		}),
	);
	const server = app.listen(0);
	servers.push(server);
	return server;
}

describe("GET /embed", () => {
	it("should return 200 and HTML content", async () => {
		const response = await request(makeServer()).get("/embed");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("carries the sitewide Content-Signal policy so /embed matches the rest of the origin", async () => {
		const response = await request(makeServer()).get("/embed");
		expect(response.headers["content-signal"]).toBe("search=yes, ai-input=yes, ai-train=no");
		expect(response.headers.vary).toMatch(/\bAccept\b/);
	});

	it("carries no Content-Signal on the embed assets (machine files, not pages)", async () => {
		const server = makeServer();
		const iconResponse = await request(server).get("/embed/icon.svg");
		expect(iconResponse.headers["content-signal"]).toBeUndefined();
		const smallIconResponse = await request(server).get("/embed/icon-small.svg");
		expect(smallIconResponse.headers["content-signal"]).toBeUndefined();
		const scriptResponse = await request(server).get("/embed/embed.client.js");
		expect(scriptResponse.headers["content-signal"]).toBeUndefined();
	});

	it("should render the hero title inside the embed page container", async () => {
		const response = await request(makeServer()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const page = doc.querySelector('[data-test-page="embed"]');
		assert(page, "embed page container must be rendered");
		const title = page.querySelector(".embed-page__title");
		assert(title, "hero title must be rendered");
		expect(title.textContent).toBe("A save button for your readers");
	});

	it("should render all three variants with numeric byte counts", async () => {
		const response = await request(makeServer()).get("/embed");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.querySelectorAll("[data-test-variant]")).toHaveLength(3);

		for (const id of ["bytes-a", "bytes-b", "bytes-c"] as const) {
			const bytes = doc.querySelector(`[data-test="${id}"]`);
			assert(bytes, `${id} byte count must be rendered`);
			expect(bytes.textContent).toMatch(/^[\d,]+ bytes$/);
		}
	});

	it("should render a URL input field inside the variants section so publishers can customise the snippets", async () => {
		const response = await request(makeServer()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const variants = doc.querySelector("#variants");
		assert(variants, "variants section must be rendered");
		const input = variants.querySelector(".embed-url-input__field");
		assert(input, "URL input must be rendered inside the variants section");
		expect(input.getAttribute("type")).toBe("url");
		expect(input.getAttribute("placeholder")).toBe("https://example.com/my-article");
	});

	it("should render every variant preview as a live anchor that passes the page URL via the save endpoint", async () => {
		const response = await request(makeServer()).get("/embed");
		const doc = new JSDOM(response.text).window.document;

		for (const id of ["preview-a", "preview-b", "preview-c"] as const) {
			const preview = doc.querySelector(`[data-test="${id}"]`);
			assert(preview, `${id} preview container must be rendered`);
			const anchor = preview.querySelector("a");
			assert(anchor, `${id} preview must contain a live anchor`);
			expect(anchor.getAttribute("href")).toContain("/save?url=");
		}
	});

	it("should render every snippet source as the canonical snippet with the PAGE_URL placeholder", async () => {
		const response = await request(makeServer()).get("/embed");
		const doc = new JSDOM(response.text).window.document;

		for (const variant of SNIPPET_VARIANTS) {
			const source = doc.querySelector(`[data-test="source-${variant}"]`);
			assert(source, `source-${variant} block must be rendered`);
			expect(source.textContent).toBe(renderCanonicalSnippet({ variant, pageUrl: PAGE_URL_PLACEHOLDER }));
		}
	});

	it("should render the hero demo as snippet B pointing at the embed page itself", async () => {
		const response = await request(makeServer()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const demo = doc.querySelector('[data-test="hero-demo"]');
		assert(demo, "hero demo container must be rendered");
		const anchor = demo.querySelector("a");
		assert(anchor, "hero demo must contain an anchor");
		expect(anchor.getAttribute("href")).toBe(
			"/save?url=https%3A%2F%2Freadplace.com%2Fembed%2F&save_surface=embed&utm_source=embed-hero&utm_medium=internal&utm_content=save-demo",
		);
	});

	it("should render the quotable privacy statement", async () => {
		const response = await request(makeServer()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const privacy = doc.querySelector('[data-test="privacy-text"]');
		assert(privacy, "privacy statement must be rendered");
		expect(privacy.textContent).toContain("plain HTML link");
		expect(privacy.textContent).toContain("sets no cookies");
	});

	it("should expose a copy button for every snippet and the privacy paragraph", async () => {
		const response = await request(makeServer()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		expect(doc.querySelectorAll("button[data-copy]")).toHaveLength(4);
	});

	it("should render every copy button hidden, so a reader without the clipboard API sees only the selectable source", async () => {
		const response = await request(makeServer()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const buttons = Array.from(doc.querySelectorAll("button[data-copy]"));
		expect(buttons.map((button) => button.hasAttribute("hidden"))).toEqual([true, true, true, true]);
	});

	it("should reference the copy-to-clipboard script same-origin, not inline", async () => {
		const response = await request(makeServer()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const script = doc.querySelector('script[src$="/embed/embed.client.js"]');
		assert(script, "the client script must be referenced");
		expect(script.getAttribute("src")).toBe("/embed/embed.client.js");
		expect(response.text).not.toContain("navigator.clipboard");
	});

	it("should serve the copy-to-clipboard script same-origin as JavaScript", async () => {
		const response = await request(makeServer()).get("/embed/embed.client.js");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain("text/javascript");
		expect(response.text).toContain("navigator.clipboard");
	});

	it("should serve the copy-to-clipboard script with a revalidating cache so it can never go stale against the per-request HTML", async () => {
		const response = await request(makeServer()).get("/embed/embed.client.js");
		expect(response.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
	});

	it("should register / with the default indexable robots directive", async () => {
		const response = await request(makeServer()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const robots = doc.querySelector('meta[name="robots"]');
		assert(robots, "robots meta must be rendered");
		expect(robots.getAttribute("content")).toBe("index, follow");
	});

	it("should point every live variant preview at the root-relative save endpoint, tagged per variant", async () => {
		const response = await request(makeServer({ appOrigin: "http://127.0.0.1:9999" })).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const hrefs = SNIPPET_VARIANTS.map((variant) => {
			const previewAnchor = doc.querySelector(`[data-test="preview-${variant}"] a`);
			assert(previewAnchor, `preview-${variant} anchor must be rendered`);
			return previewAnchor.getAttribute("href");
		});
		expect(hrefs).toEqual(
			SNIPPET_VARIANTS.map(
				(variant) =>
					`/save?url=http%3A%2F%2F127.0.0.1%3A9999%2Fembed%2F&save_surface=embed&utm_source=embed-variants&utm_medium=internal&utm_content=save-variant-${variant}`,
			),
		);
	});

	it("should substitute the embed origin in live preview icon URLs so the dev server can serve them", async () => {
		const response = await request(makeServer({ appOrigin: "http://localhost:3700" })).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const previewImg = doc.querySelector('[data-test="preview-a"] img');
		assert(previewImg, "preview-a img must be rendered");
		expect(previewImg.getAttribute("src")).toBe("http://localhost:3700/embed/icon.svg?v=2");
	});

	it("should keep the canonical readplace.com URLs and PAGE_URL placeholder inside the copy-paste source blocks regardless of config", async () => {
		const response = await request(makeServer({ appOrigin: "http://127.0.0.1:9999" })).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const source = doc.querySelector('[data-test="source-b"]');
		assert(source, "source-b must be rendered");
		expect(source.textContent).toBe(renderCanonicalSnippet({ variant: "b", pageUrl: PAGE_URL_PLACEHOLDER }));
	});

	it("should link the footer back to the Readplace app origin, tagged so the click is attributable", async () => {
		const response = await request(makeServer()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const link = doc.querySelector('[data-test="link-app"]');
		assert(link, "app link must be rendered");
		expect(link.getAttribute("href")).toBe("/?utm_source=embed-footer&utm_medium=internal&utm_content=home");
	});

	it("should render the shared guest header nav when no session cookie resolves to a user", async () => {
		const response = await request(makeServer()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const nav = doc.querySelector("[data-test-nav-variant]");
		assert(nav, "shared nav must be rendered");
		expect(nav.getAttribute("data-test-nav-variant")).toBe("guest");
	});

	it("should render the shared authenticated header nav when the session cookie resolves to a user", async () => {
		const response = await request(makeServer({ resolveLogin: authedResolver }))
			.get("/embed")
			.set("Cookie", "hutch_sid=valid");
		const doc = new JSDOM(response.text).window.document;
		const nav = doc.querySelector("[data-test-nav-variant]");
		assert(nav, "shared nav must be rendered");
		expect(nav.getAttribute("data-test-nav-variant")).toBe("authenticated");
		const items = Array.from(doc.querySelectorAll("[data-test-nav-item]")).map((el) =>
			el.getAttribute("data-test-nav-item"),
		);
		expect(items).toEqual(expect.arrayContaining(["queue", "import", "inbox", "account", "logout"]));
	});

	it("should pin a guest's page to the light theme", async () => {
		const response = await request(makeServer()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		expect(Array.from(doc.body.classList)).toEqual(["page-embed", "theme-light"]);
	});

	it("should let a signed-in reader's page follow the system theme", async () => {
		const response = await request(makeServer({ resolveLogin: authedResolver }))
			.get("/embed")
			.set("Cookie", "hutch_sid=valid");
		const doc = new JSDOM(response.text).window.document;
		expect(Array.from(doc.body.classList)).toEqual(["page-embed"]);
	});

	it("should tie each snippet body to its canonical PAGE_URL template and its byte chip, for live substitution", async () => {
		const response = await request(makeServer()).get("/embed?url=https://example.com/a");
		const doc = new JSDOM(response.text).window.document;

		for (const variant of SNIPPET_VARIANTS) {
			const source = doc.querySelector(`[data-test="source-${variant}"]`);
			assert(source, `source-${variant} block must be rendered`);
			expect(source.getAttribute("data-snippet-template")).toBe(
				renderCanonicalSnippet({ variant, pageUrl: PAGE_URL_PLACEHOLDER }),
			);
			const bytes = doc.querySelector(`[data-test="bytes-${variant}"]`);
			assert(bytes, `bytes-${variant} chip must be rendered`);
			expect(bytes.getAttribute("data-snippet-bytes")).toBe(source.id);
		}
	});
});

describe("GET /embed article link form", () => {
	function urlField(doc: Document): Element {
		const field = doc.querySelector('#variants form [name="url"]');
		assert(field, "the article link field must be rendered inside the variants section");
		return field;
	}

	function errorText(doc: Document): string | null {
		const error = doc.querySelector('[data-test="url-error"]');
		assert(error, "the field error slot must be rendered");
		return error.textContent;
	}

	function sources(doc: Document): (string | null)[] {
		return SNIPPET_VARIANTS.map((variant) => {
			const source = doc.querySelector(`[data-test="source-${variant}"]`);
			assert(source, `source-${variant} block must be rendered`);
			return source.textContent;
		});
	}

	function byteCounts(doc: Document): (string | null)[] {
		return SNIPPET_VARIANTS.map((variant) => {
			const bytes = doc.querySelector(`[data-test="bytes-${variant}"]`);
			assert(bytes, `bytes-${variant} chip must be rendered`);
			return bytes.textContent;
		});
	}

	function placeholderSources(): string[] {
		return SNIPPET_VARIANTS.map((variant) => renderCanonicalSnippet({ variant, pageUrl: PAGE_URL_PLACEHOLDER }));
	}

	it("submits a GET back to the variants band of /embed, carrying its UTM tags in hidden inputs and the link as a url field", async () => {
		const response = await request(makeServer()).get("/embed");
		const doc = new JSDOM(response.text).window.document;
		const field = urlField(doc);
		const form = field.closest("form");
		assert(form, "the article link field must sit inside a form");
		expect(form.getAttribute("method")).toBe("GET");
		expect(form.getAttribute("action")).toBe("/embed#variants");
		const hidden = Array.from(form.querySelectorAll('input[type="hidden"]')).map((input) => [
			input.getAttribute("name"),
			input.getAttribute("value"),
		]);
		expect(hidden).toEqual([
			["utm_source", "embed-variants"],
			["utm_medium", "internal"],
			["utm_content", "customise-snippets"],
		]);
		expect(field.getAttribute("type")).toBe("url");
	});

	it("renders every snippet with the reader's link, and counts the bytes of exactly that source", async () => {
		const response = await request(makeServer()).get(
			"/embed?utm_source=embed-variants&utm_medium=internal&utm_content=customise-snippets&url=https%3A%2F%2Fexample.com%2Fa",
		);
		const doc = new JSDOM(response.text).window.document;
		const expected = SNIPPET_VARIANTS.map((variant) =>
			renderCanonicalSnippet({ variant, pageUrl: "https://example.com/a" }),
		);
		expect(sources(doc)).toEqual(expected);
		expect(byteCounts(doc)).toEqual(expected.map((source) => `${byteLength(source).toLocaleString("en-US")} bytes`));
		expect(urlField(doc).getAttribute("value")).toBe("https://example.com/a");
		expect(urlField(doc).getAttribute("aria-invalid")).toBe("false");
		expect(errorText(doc)).toBe("");
	});

	it("keeps the PAGE_URL placeholder and no error when the link is left empty", async () => {
		const response = await request(makeServer()).get("/embed?url=");
		const doc = new JSDOM(response.text).window.document;
		expect(sources(doc)).toEqual(placeholderSources());
		expect(urlField(doc).getAttribute("value")).toBe("");
		expect(urlField(doc).getAttribute("aria-invalid")).toBe("false");
		expect(errorText(doc)).toBe("");
	});

	it("puts an invalid link back in the field with an error, and keeps the snippets on the PAGE_URL placeholder", async () => {
		const response = await request(makeServer()).get("/embed?url=nope");
		const doc = new JSDOM(response.text).window.document;
		const field = urlField(doc);
		expect(sources(doc)).toEqual(placeholderSources());
		expect(field.getAttribute("value")).toBe("nope");
		expect(field.getAttribute("aria-invalid")).toBe("true");
		expect(field.getAttribute("aria-describedby")).toBe("article-url-error");
		expect(field.classList.contains("embed-url-input__field--invalid")).toBe(true);
		expect(errorText(doc)).toBe("Enter a full link, including https://.");
	});

	it("treats a repeated url parameter as an invalid link", async () => {
		const response = await request(makeServer()).get("/embed?url=https://example.com/a&url=https://example.com/b");
		const doc = new JSDOM(response.text).window.document;
		expect(sources(doc)).toEqual(placeholderSources());
		expect(urlField(doc).getAttribute("value")).toBe("");
		expect(urlField(doc).getAttribute("aria-invalid")).toBe("true");
		expect(errorText(doc)).toBe("Enter a full link, including https://.");
	});

	it("serves each snippet source as a fenced code block to a markdown reader", async () => {
		const response = await request(makeServer()).get("/embed").set("Accept", "text/markdown");
		expect(response.headers["content-type"]).toMatch(/text\/markdown/);
		for (const variant of SNIPPET_VARIANTS) {
			const source = renderCanonicalSnippet({ variant, pageUrl: PAGE_URL_PLACEHOLDER });
			expect(response.text).toContain(`\`\`\`\n${source}\n\`\`\``);
		}
	});
});

describe("GET /embed/preview", () => {
	it("should return 200 and HTML content", async () => {
		const response = await request(makeServer()).get("/embed/preview");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("should be marked noindex so search engines skip the developer preview", async () => {
		const response = await request(makeServer()).get("/embed/preview");
		const doc = new JSDOM(response.text).window.document;
		const robots = doc.querySelector('meta[name="robots"]');
		assert(robots, "robots meta must be rendered");
		expect(robots.getAttribute("content")).toBe("noindex, nofollow");
	});

	it("should render one stage per background", async () => {
		const response = await request(makeServer()).get("/embed/preview");
		const doc = new JSDOM(response.text).window.document;
		for (const bg of ["white", "surface", "dark"] as const) {
			const stage = doc.querySelector(`[data-test-bg="${bg}"]`);
			assert(stage, `${bg} stage must be rendered`);
		}
	});

	it("should tag every stage's save links with that stage and the variant", async () => {
		const response = await request(makeServer()).get("/embed/preview");
		const doc = new JSDOM(response.text).window.document;
		const hrefs = Array.from(doc.querySelectorAll(".embed-preview__stage a")).map((anchor) => anchor.getAttribute("href"));
		const expected = ["white", "surface", "dark"].flatMap((stage) =>
			SNIPPET_VARIANTS.map(
				(variant) =>
					`/save?url=https%3A%2F%2Freadplace.com%2Fembed%2Fpreview&save_surface=embed&utm_source=embed-preview-${stage}&utm_medium=internal&utm_content=save-variant-${variant}`,
			),
		);
		expect(hrefs).toEqual(expected);
	});

	it("should render each variant once inside every background stage", async () => {
		const response = await request(makeServer()).get("/embed/preview");
		const doc = new JSDOM(response.text).window.document;
		const stages = doc.querySelectorAll(".embed-preview__stage");
		expect(stages).toHaveLength(3);
		for (const stage of Array.from(stages)) {
			expect(stage.querySelectorAll("a")).toHaveLength(3);
		}
	});
});

describe("GET /embed/icon-small.svg", () => {
	it("should return the dotless small mark with the SVG content type and immutable cache header", async () => {
		const response = await request(makeServer())
			.get("/embed/icon-small.svg")
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
		const doc = new JSDOM(response.body).window.document;
		const svg = doc.querySelector("svg");
		assert(svg, "the small mark must be an svg");
		expect(svg.getAttribute("viewBox")).toBe("0 0 512 512");
		const tile = doc.querySelector("rect");
		assert(tile, "the small mark must carry its navy tile");
		expect(tile.getAttribute("fill")).toBe("#2B3A55");
		expect(tile.getAttribute("stroke-opacity")).toBe("0.4");
		const glyph = doc.querySelector("path");
		assert(glyph, "the small mark must carry its ampersand");
		expect(glyph.getAttribute("d")).toMatch(/^M207\.77 405\.2Q/);
		expect(doc.querySelectorAll("circle")).toHaveLength(0);
	});
});

describe("GET /embed/icon.svg", () => {
	it("should return the embed icon SVG with the correct content type and immutable cache header", async () => {
		const response = await request(makeServer())
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
		expect(response.body).toContain('fill="#2B3A55"');
		expect(response.body).toContain('stroke="#FFFFFF"');
		expect(response.body).toContain('stroke-opacity="0.4"');
	});
});
