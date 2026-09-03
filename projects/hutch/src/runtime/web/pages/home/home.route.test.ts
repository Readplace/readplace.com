import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { BROWSER_REQUEST_HEADERS, useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { MAX_PDF_PAGES } from "@packages/crawl-article";
import { ADVERTISED_CLIENTS, UNADVERTISED_CLIENTS } from "@packages/supported-clients";
import {
	HOME_BROWSER_EXTENSION_ROW,
	HOME_CONTENT,
	HOME_NATIVE_APP_ROW_BY_CLIENT,
	HOME_WAY_LINK_BY_CLIENT,
	HOME_WAYS_WITHOUT_A_CLIENT,
} from "./home.content";
import { HOMEPAGE_EXPOSURE } from "./home.version";

const GOOGLEBOT_UA =
	"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const useApp = useTestServer();

async function loadHomepage(cookie?: string) {
	const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
	const pending = request(harness.server).get("/");
	const response = await (cookie === undefined ? pending : pending.set("Cookie", cookie));
	return { harness, response, doc: new JSDOM(response.text).window.document };
}

describe("GET / (authenticated)", () => {
	it("should redirect a signed-in reader to their readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const response = await agent.get("/");
		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
	});
});

describe("GET / (retired split arm URLs)", () => {
	it.each(["/landing-a", "/landing-b"])(
		"should redirect %s to the one homepage those arms became",
		async (path) => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get(path);
			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/");
		},
	);
});

describe("GET /", () => {
	it("should return 200 and HTML content", async () => {
		const { response } = await loadHomepage();
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("should have page-home body class", async () => {
		const { doc } = await loadHomepage();
		expect(doc.body.classList.contains("page-home")).toBe(true);
	});

	it("should be indexable and canonical to the bare origin", async () => {
		const { doc } = await loadHomepage();
		expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("index, follow");
		expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
			"https://readplace.com/",
		);
	});

	it("should keep the response out of shared caches, because the arrival treatment varies per visitor", async () => {
		const { response } = await loadHomepage();
		expect(response.headers["cache-control"]).toBe("private, no-cache");
	});

	it("should stamp the homepage version on its own pageview so it stays separable from the retired arms", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await request(harness.server).get("/").set(BROWSER_REQUEST_HEADERS);

		expect(harness.analytics.events).toContainEqual(
			expect.objectContaining({
				event: "pageview",
				path: "/",
				experiment: HOMEPAGE_EXPOSURE.campaign,
				experiment_variant: HOMEPAGE_EXPOSURE.version,
			}),
		);
	});

	it("should leave a crawler out of the measurement, so the version's visitor count stays human", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await request(harness.server)
			.get("/")
			.set(BROWSER_REQUEST_HEADERS)
			.set("User-Agent", GOOGLEBOT_UA);

		expect(harness.analytics.events).toEqual([]);
	});
});

describe("GET / hero", () => {
	it("should render the static headline, with no rotator attribute for a client to swap", async () => {
		const { doc } = await loadHomepage();

		const tagline = doc.querySelector("[data-test-tagline]");
		assert(tagline, "tagline must be rendered");
		expect(tagline.textContent?.trim()).toBe(HOME_CONTENT.hero.title);
		expect(tagline.hasAttribute("data-slogans")).toBe(false);
	});

	it("should render the paste-a-link form as the hero's only action, with the UTM hidden inputs a GET submit needs", async () => {
		const { doc } = await loadHomepage();

		const forms = Array.from(doc.querySelectorAll("[data-test-hero-form]")).map((form) =>
			form.getAttribute("data-test-hero-form"),
		);
		expect(forms).toEqual(["homepage-link-input"]);

		const form = doc.querySelector('[data-test-hero-form="homepage-link-input"]');
		assert(form, "paste form must be rendered");
		expect(form.getAttribute("method")?.toLowerCase()).toBe("get");
		expect(form.getAttribute("action")).toBe("/view");

		const input = form.querySelector('input[name="url"]');
		assert(input, "url input must be rendered");
		expect(input.getAttribute("type")).toBe("url");
		expect(input.hasAttribute("required")).toBe(true);

		const hidden = Object.fromEntries(
			Array.from(form.querySelectorAll('input[type="hidden"]')).map((field) => [
				field.getAttribute("name"),
				field.getAttribute("value"),
			]),
		);
		expect(hidden).toEqual({
			utm_source: "homepage",
			utm_medium: "internal",
			utm_content: "homepage-link-input",
		});

		expect(form.querySelector("button")?.textContent?.trim()).toBe(
			HOME_CONTENT.hero.pasteCtaLabel,
		);
	});

	it("should hand the paste form to the save tip, so the advisory panel speaks for it", async () => {
		const { doc } = await loadHomepage();

		const form = doc.querySelector('[data-test-hero-form="homepage-link-input"]');
		expect(form?.getAttribute("data-save-tip")).toBe("due");
	});

	it("should carry no eyebrow when the visitor did not arrive from the reader", async () => {
		const { doc } = await loadHomepage();
		expect(doc.querySelector("[data-test-hero-eyebrow]")).toBeNull();
	});

	it("should redirect a paste-link submission to the canonical reader URL", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(
			"/view?url=https%3A%2F%2Fexample.com%2Farticle&utm_source=homepage&utm_medium=internal&utm_content=homepage-link-input",
		);
		expect(response.status).toBe(302);
		expect(response.headers.location).toBe("/view/example.com/article");
	});
});

describe("GET / hero (arriving from the reader view)", () => {
	const lastViewCookie = `hutch_lastview=${encodeURIComponent("https://example.com/article")}`;

	it("should offer the article just read first, keeping the paste box below it", async () => {
		const { doc } = await loadHomepage(lastViewCookie);

		const keys = Array.from(doc.querySelectorAll("[data-test-hero-form]")).map((form) =>
			form.getAttribute("data-test-hero-form"),
		);
		expect(keys).toEqual(["hero-save-last-view", "homepage-link-input"]);
	});

	it("should point the save action at the article, tagged as the homepage hero surface", async () => {
		const { doc } = await loadHomepage(lastViewCookie);

		const form = doc.querySelector('[data-test-hero-form="hero-save-last-view"]');
		assert(form, "save-last-view form must be rendered");
		expect(form.getAttribute("action")).toBe("/save");

		const hidden = Object.fromEntries(
			Array.from(form.querySelectorAll('input[type="hidden"]')).map((field) => [
				field.getAttribute("name"),
				field.getAttribute("value"),
			]),
		);
		expect(hidden).toEqual({
			url: "https://example.com/article",
			save_surface: "homepage_hero",
			utm_source: "homepage",
			utm_medium: "internal",
			utm_content: "hero-save-last-view",
		});
	});

	it("should name the article the save would act on, so a reader who left it minutes ago knows which one", async () => {
		const { doc } = await loadHomepage(
			`hutch_lastview=${encodeURIComponent("https://www.nytimes.com/2026/01/07/opinion/near-death-conference-grief-chicago.html")}`,
		);

		expect(doc.querySelector('[data-test-cta="hero-save-last-view"]')?.textContent?.trim()).toBe(
			"Save the nytimes.com article",
		);
		const target = doc.querySelector('[data-test-hero-target="hero-save-last-view"]');
		assert(target, "the arrival must name the article the save would act on");
		expect(target.textContent?.trim()).toBe(
			"nytimes.com/2026/01/07/opinion/near-death-conference-grief-chicago.html",
		);
		expect(target.getAttribute("href")).toBe(
			"/view?url=https%3A%2F%2Fwww.nytimes.com%2F2026%2F01%2F07%2Fopinion%2Fnear-death-conference-grief-chicago.html&utm_source=homepage&utm_medium=internal&utm_content=hero-last-view-article",
		);
	});

	it("should fall back to an unnamed save when the cookie does not hold a URL, rather than failing the render", async () => {
		const { response, doc } = await loadHomepage("hutch_lastview=not-a-url");

		expect(response.status).toBe(200);
		expect(doc.querySelector('[data-test-cta="hero-save-last-view"]')?.textContent?.trim()).toBe(
			HOME_CONTENT.hero.saveLastViewFallbackLabel,
		);
		expect(doc.querySelector('[data-test-hero-target="hero-save-last-view"]')).toBeNull();
	});

	it("should name the arrival in an eyebrow and lead the demoted paste box", async () => {
		const { doc } = await loadHomepage(lastViewCookie);

		expect(doc.querySelector("[data-test-hero-eyebrow]")?.textContent?.trim()).toBe(
			HOME_CONTENT.hero.arrivalEyebrow,
		);
		expect(doc.querySelector(".home-hero__action-lead")?.textContent?.trim()).toBe(
			HOME_CONTENT.hero.saveLastViewLead,
		);
	});
});

const EXPECTED_WAYS = [
	{
		name: HOME_BROWSER_EXTENSION_ROW.name,
		links: ADVERTISED_CLIENTS.flatMap((client) =>
			client.group === "browserExtension" ? [HOME_WAY_LINK_BY_CLIENT[client.name]] : [],
		)
			.slice()
			.sort((left, right) => left.order - right.order),
	},
	...ADVERTISED_CLIENTS.flatMap((client) =>
		client.group === "nativeApp"
			? [
					{
						name: HOME_NATIVE_APP_ROW_BY_CLIENT[client.name].name,
						links: [HOME_WAY_LINK_BY_CLIENT[client.name]],
					},
				]
			: [],
	),
	...HOME_WAYS_WITHOUT_A_CLIENT.map((way) => ({ name: way.name, links: way.links })),
];

describe("GET / ways to save", () => {
	it("should list one row per advertised content-capture client, then the ways in with no client behind them", async () => {
		const { doc } = await loadHomepage();

		const names = Array.from(doc.querySelectorAll("[data-test-way]")).map((item) =>
			item.getAttribute("data-test-way"),
		);
		expect(names).toEqual(EXPECTED_WAYS.map((way) => way.name));
	});

	it("should not offer a client nobody can install yet", async () => {
		const { doc } = await loadHomepage();

		const waysText = Array.from(doc.querySelectorAll("[data-test-way]"))
			.map((row) => row.textContent)
			.join(" ");
		for (const client of UNADVERTISED_CLIENTS) {
			expect(waysText).not.toContain(client.displayName);
		}
	});

	it("should keep every sample newsletter address on one line, so a hyphen cannot read as a line break", async () => {
		const { doc } = await loadHomepage();

		const examples = Array.from(doc.querySelectorAll(".home-ways__example")).map((node) =>
			node.textContent,
		);
		expect(examples).toEqual(["my-tech-newsletter@read.place", "my-other-newsletter@read.place"]);
	});

	it("should merge the browser extensions into one row offering both installs", async () => {
		const { doc } = await loadHomepage();

		const row = doc.querySelector(
			`[data-test-way="${HOME_BROWSER_EXTENSION_ROW.name}"]`,
		);
		assert(row, "the browser-extension row must be rendered");

		const labels = Array.from(row.querySelectorAll("[data-test-way-link]")).map((link) =>
			link.textContent?.trim().replace(/\s+$/, ""),
		);
		expect(labels).toEqual([
			HOME_WAY_LINK_BY_CLIENT.chrome.label,
			HOME_WAY_LINK_BY_CLIENT.firefox.label,
		]);
	});

	it("should route the iPhone row's App Store mention through the tracked install page, so the click is countable", async () => {
		const { doc } = await loadHomepage();

		expect(
			doc
				.querySelector(`[data-test-way-body-link="${HOME_NATIVE_APP_ROW_BY_CLIENT.iphone.name}"]`)
				?.getAttribute("href"),
		).toBe(
			"/install?client=iphone&utm_source=home-ways&utm_medium=internal&utm_content=iphone-app-store",
		);
	});

	it("should quote the PDF page limit from the crawler's own constant", async () => {
		const { doc } = await loadHomepage();

		expect(doc.querySelector(".home-ways__note")?.textContent).toContain(
			`up to ${MAX_PDF_PAGES} pages`,
		);
	});

	it("should tag every way-to-save link to its own section, so a click is countable per element", async () => {
		const { doc } = await loadHomepage();

		const hrefs = Array.from(doc.querySelectorAll("[data-test-way-link]")).map((link) =>
			link.getAttribute("href"),
		);
		expect(hrefs).toEqual([
			...EXPECTED_WAYS.flatMap((way) =>
				way.links.map(
					(link) =>
						`${link.href}${link.href.includes("?") ? "&" : "?"}utm_source=home-ways&utm_medium=internal&utm_content=${link.trackContent}`,
				),
			),
			"/pdf-ocr?utm_source=home-ways&utm_medium=internal&utm_content=pdf",
		]);
	});

	it("should keep the paste anchor the hero owns, so a way-to-save link can reach it", async () => {
		const { doc } = await loadHomepage();
		assert(doc.querySelector("#paste-a-link"), "the hero must keep the paste anchor id");
	});
});

describe("GET / assistant", () => {
	it("should give the AI assistant route its own section, tagged separately from the ways list", async () => {
		const { doc } = await loadHomepage();

		const section = doc.querySelector('[data-test-section="assistant"]');
		assert(section, "assistant section must be rendered");
		expect(section.querySelector("h2")?.textContent?.trim()).toBe(HOME_CONTENT.assistant.title);

		expect(doc.querySelector('[data-test-cta="assistant"]')?.getAttribute("href")).toBe(
			"/mcp?utm_source=home-assistant&utm_medium=internal&utm_content=mcp",
		);
	});
});

describe("GET / proof", () => {
	it("should render one extension demo video that reserves its box and names itself", async () => {
		const { doc } = await loadHomepage();

		const videos = doc.querySelectorAll(".home-proof__video");
		expect(videos.length).toBe(1);
		const video = videos[0];
		expect(video.getAttribute("preload")).toBe("none");
		expect(video.hasAttribute("controls")).toBe(true);
		expect(video.hasAttribute("autoplay")).toBe(false);
		expect(video.hasAttribute("loop")).toBe(false);

		// Width, height and poster together hold the box before the video decodes,
		// which is what keeps the section from shifting under the reader.
		expect(video.getAttribute("width")).toBe("1280");
		expect(video.getAttribute("height")).toBe("800");
		expect(video.getAttribute("poster")).toMatch(/\.(png|jpg|webp)$/);
		expect(video.getAttribute("aria-label")).toBe(HOME_CONTENT.proof.videoAriaLabel);

		const sourceTypes = Array.from(video.querySelectorAll("source")).map((source) =>
			source.getAttribute("type"),
		);
		expect(sourceTypes.length).toBeGreaterThan(0);
		expect(sourceTypes).toContain("video/mp4");
	});

	it("should quote the early user by name", async () => {
		const { doc } = await loadHomepage();

		expect(doc.querySelector(".home-proof__quote-text")?.textContent).toContain("it just works");
		expect(doc.querySelector(".home-proof__quote-by")?.textContent).toContain("Matthew Motz");
	});

	it("should link the founder's case for deciding what not to read through the reader view", async () => {
		const { doc } = await loadHomepage();

		expect(doc.querySelector('[data-test-cta="what-not-to-read"]')?.getAttribute("href")).toBe(
			"/view?url=https%3A%2F%2Ffagnerbrack.com%2Fwhats-the-point-to-save-articles-youll-never-read-22d07f6609ad&utm_source=home-proof&utm_medium=internal&utm_content=what-not-to-read",
		);
	});
});

describe("GET / principle", () => {
	it("should make the promise in the founder's own name, with his face beside it", async () => {
		const { doc } = await loadHomepage();

		const heading = doc.querySelector(".home-principle__title");
		assert(heading, "the promise must be a section heading");
		expect(heading.textContent?.trim()).toBe(HOME_CONTENT.principle.title);

		const avatar = heading.querySelector("img");
		assert(avatar, "the promise must carry the founder's avatar");
		expect(avatar.getAttribute("alt")).toBe(HOME_CONTENT.principle.avatarAlt);
		expect(avatar.getAttribute("width")).toBe("56");
		expect(avatar.getAttribute("height")).toBe("56");
	});

	it("should say what Readplace is for, and what it will never grow to chase", async () => {
		const { doc } = await loadHomepage();

		const body = doc.querySelector(".home-principle__body")?.textContent ?? "";
		expect(body).toBe(HOME_CONTENT.principle.body);
		expect(body).toContain("social feeds");
		expect(body).toContain("reading what matters, not saving more");
		expect(body).not.toContain("recommendation algorithms");
	});
});

describe("GET / pricing", () => {
	it("should offer one priced plan, with no founding-member card to branch on", async () => {
		const { doc } = await loadHomepage();

		const ctas = Array.from(doc.querySelectorAll('[data-test-section="pricing"] button')).map(
			(button) => button.querySelector(".home-pricing__cta-label")?.textContent?.trim(),
		);
		expect(ctas).toEqual([HOME_CONTENT.pricing.ctaLabel]);
		expect(doc.querySelector(".home-pricing__cta-sub")?.textContent?.trim()).toBe(
			HOME_CONTENT.pricing.ctaSubLabel,
		);
		expect(doc.querySelector('[data-test-plan="founding"]')).toBeNull();
	});

	it("should send the signup CTA to /signup carrying the element it was clicked from", async () => {
		const { doc } = await loadHomepage();

		const form = doc.querySelector(".home-pricing__cta");
		assert(form, "pricing CTA form must be rendered");
		expect(form.getAttribute("action")).toBe("/signup");

		const hidden = Object.fromEntries(
			Array.from(form.querySelectorAll('input[type="hidden"]')).map((field) => [
				field.getAttribute("name"),
				field.getAttribute("value"),
			]),
		);
		expect(hidden).toEqual({
			utm_source: "homepage",
			utm_medium: "internal",
			utm_content: "signup-body",
		});
	});

	it("should carry the export and hosting assurances beside the price", async () => {
		const { doc } = await loadHomepage();

		const assurances = Array.from(doc.querySelectorAll(".home-pricing__assurance")).map((item) =>
			item.textContent?.trim(),
		);
		expect(assurances).toEqual([...HOME_CONTENT.pricing.assurances]);
	});
});

describe("GET / questions and close", () => {
	it("should render every FAQ entry as visible copy, not only as structured data", async () => {
		const { doc } = await loadHomepage();

		const questions = Array.from(doc.querySelectorAll("[data-test-faq-question]")).map((term) =>
			term.textContent?.trim(),
		);
		expect(questions).toEqual(HOME_CONTENT.faq.items.map((entry) => entry.question));
	});

	it("should close on the two links readers actually take, and no third signup button", async () => {
		const { doc } = await loadHomepage();

		expect(doc.querySelector('[data-test-cta="close-install"]')?.getAttribute("href")).toBe(
			"/install?utm_source=home-close&utm_medium=internal&utm_content=install",
		);
		expect(doc.querySelector('[data-test-cta="close-import"]')?.getAttribute("href")).toBe(
			"/import?utm_source=home-close&utm_medium=internal&utm_content=import",
		);
		expect(doc.querySelectorAll('[data-test-section="close"] button').length).toBe(0);
	});

	it("should sign off with the canonical slogan", async () => {
		const { doc } = await loadHomepage();
		expect(doc.querySelector(".home-close__signoff")?.textContent).toContain(
			"Your #1 AI-Powered Reading List.",
		);
	});
});

describe("GET / metadata", () => {
	it("should set SEO metadata within the length search engines render", async () => {
		const { doc } = await loadHomepage();

		expect(doc.title).toContain("Readplace");
		expect(doc.title).toContain("Your #1 AI-Powered Reading List");
		expect(doc.title).toContain("Read It Later");
		expect(doc.title.length).toBeLessThanOrEqual(60);

		const description = doc.querySelector('meta[name="description"]');
		expect(description?.getAttribute("content")).toContain("read-it-later app");
		expect(description?.getAttribute("content")).toContain("no credit card");

		const keywords = doc.querySelector('meta[name="keywords"]');
		expect(keywords?.getAttribute("content")).toContain("personal reading list");
		expect(keywords?.getAttribute("content")).toContain("no LLM hallucination");
		expect(keywords?.getAttribute("content")).toContain("Pocket alternative");
	});

	it("should include author and Open Graph image alt text", async () => {
		const { doc } = await loadHomepage();

		expect(doc.querySelector('meta[name="author"]')?.getAttribute("content")).toBe("Fayner Brack");
		expect(doc.querySelector('meta[property="og:image:alt"]')?.getAttribute("content")).toContain(
			"Readplace",
		);
	});

	it("should not include twitter:site when no handle is configured", async () => {
		const { doc } = await loadHomepage();

		const twitterMetaNames = Array.from(doc.querySelectorAll('meta[name^="twitter:"]')).map(
			(meta) => meta.getAttribute("name"),
		);
		expect(twitterMetaNames).toEqual([
			"twitter:card",
			"twitter:title",
			"twitter:description",
			"twitter:image",
			"twitter:creator",
		]);
	});

	it("should include the four structured data schemas", async () => {
		const { doc } = await loadHomepage();

		const schemas = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map(
			(script) => JSON.parse(script.textContent ?? "{}"),
		);
		expect(schemas.map((schema: { "@type": string }) => schema["@type"])).toEqual([
			"WebApplication",
			"Organization",
			"FAQPage",
			"WebSite",
		]);
	});

	it("should link the Organization to the App Store listing and offer the Smart App Banner", async () => {
		const { doc } = await loadHomepage();

		const schemas = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map(
			(script) => JSON.parse(script.textContent ?? "{}"),
		);
		const organization = schemas.find((schema: { "@type": string }) => schema["@type"] === "Organization");
		expect(organization.sameAs).toContain("https://apps.apple.com/app/readplace/id6777107238");

		expect(doc.querySelector('meta[name="apple-itunes-app"]')?.getAttribute("content")).toBe(
			"app-id=6777107238",
		);
	});

	it("should build the FAQ structured data from the questions the page renders, so the two cannot drift", async () => {
		const { doc } = await loadHomepage();

		const schemas = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map(
			(script) => JSON.parse(script.textContent ?? "{}"),
		);
		const faq = schemas.find((schema: { "@type": string }) => schema["@type"] === "FAQPage");

		expect(faq.mainEntity.map((entry: { name: string }) => entry.name)).toEqual(
			HOME_CONTENT.faq.items.map((entry) => entry.question),
		);
	});

	it("should advertise only the priced plan, now that the homepage no longer offers a free tier", async () => {
		const { doc } = await loadHomepage();

		const schemas = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map(
			(script) => JSON.parse(script.textContent ?? "{}"),
		);
		const app = schemas.find((schema: { "@type": string }) => schema["@type"] === "WebApplication");

		expect(app.isAccessibleForFree).toBe(false);
		expect(app.offers.name).toBe("Standard");
		expect(app.offers.price).toBe("49");
	});

	it("should include the reader review nested in the WebApplication structured data", async () => {
		const { doc } = await loadHomepage();

		const schemas = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map(
			(script) => JSON.parse(script.textContent ?? "{}"),
		);
		const app = schemas.find((schema: { "@type": string }) => schema["@type"] === "WebApplication");

		assert(app.review, "WebApplication schema must include a review");
		expect(app.review["@type"]).toBe("Review");
		expect(app.review.author.name).toBe("Matthew Motz");
		expect(app.review.reviewBody).toContain("it just works");
		expect(app.review.reviewRating.ratingValue).toBe("5");
	});

	it("should render section landmarks with aria-labels", async () => {
		const { doc } = await loadHomepage();

		const labels = Array.from(doc.querySelectorAll("[data-test-section]")).map((section) => [
			section.getAttribute("data-test-section"),
			section.getAttribute("aria-label"),
		]);
		expect(labels).toEqual([
			["hero", "What Readplace is"],
			["ways-to-save", "Every way to save"],
			["assistant", "Save from an AI assistant"],
			["proof", "What that looks like"],
			["principle", "What Readplace is for"],
			["pricing", "Pricing"],
			["faq", "Questions"],
			["close", "Get started"],
		]);
	});

	it("should ship no page-specific client bundle, because nothing on the page needs one", async () => {
		const { doc } = await loadHomepage();

		const scripts = Array.from(doc.querySelectorAll("script[src]")).map((script) =>
			script.getAttribute("src"),
		);
		expect(scripts).not.toContain("/client-dist/home.client.js");
		expect(scripts).toContain("/client-dist/save-tip.client.js");
	});
});
