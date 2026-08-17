import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { BROWSER_REQUEST_HEADERS, useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { HOMEPAGE_SPLIT } from "../../experiments/homepage-split";
import { CANONICAL_SLOGAN, SLOGANS } from "../../slogans";

const TEST_FOUNDING_MEMBER_LIMIT = 3;
const GOOGLEBOT_UA =
	"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

const useApp = useTestServer();
const useAppDrawingArmB = useTestServer({ drawRandomByte: () => 200 });

function readSetCookie(
	response: { headers: Record<string, string | string[] | undefined> },
	name: string,
): string | undefined {
	const raw = response.headers["set-cookie"];
	const header = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
	const match = header.find((cookie) => cookie.startsWith(`${name}=`));
	if (!match) return undefined;
	return decodeURIComponent(match.slice(name.length + 1).split(";")[0]);
}

describe("GET / (authenticated)", () => {
	it("should redirect a logged-in visitor straight to /queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent.get("/");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
	});
});

describe("GET / (homepage A/B arm)", () => {
	it("renders the drawn arm on the visitor's first paint, with no redirect to swap it afterwards", async () => {
		const harness = useAppDrawingArmB(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		expect(response.status).toBe(200);
		assert(doc.querySelector("[data-test-variant-b]"), "the drawn arm must render at /");
		expect(doc.body.classList.contains("variant-b")).toBe(true);
		expect(readSetCookie(response, "hutch_exp")).toBe("homepage-split:3:variant-b");
	});

	it("draws the incumbent arm from the low half of the byte range and records that too", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.body.classList.contains("variant-a")).toBe(true);
		expect(readSetCookie(response, "hutch_exp")).toBe("homepage-split:3:variant-a");
	});

	it("re-renders the recorded arm instead of drawing again, so a returning visitor keeps their page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/")
			.set("Cookie", ["hutch_exp=homepage-split%3A3%3Avariant-b"]);
		const doc = new JSDOM(response.text).window.document;

		assert(doc.querySelector("[data-test-variant-b]"), "the recorded arm must render at /");
		expect(readSetCookie(response, "hutch_exp")).toBe("homepage-split:3:variant-b");
	});

	it("re-draws when the recorded arm is from a bumped epoch", async () => {
		const harness = useAppDrawingArmB(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/")
			.set("Cookie", ["hutch_exp=homepage-split%3A1%3Avariant-a"]);
		const doc = new JSDOM(response.text).window.document;

		assert(doc.querySelector("[data-test-variant-b]"), "a stale epoch must be re-bucketed");
		expect(readSetCookie(response, "hutch_exp")).toBe("homepage-split:3:variant-b");
	});

	it("keeps a crawler on the incumbent arm and never records it, so an arm is not indexed by a coin flip", async () => {
		const harness = useAppDrawingArmB(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/").set("User-Agent", GOOGLEBOT_UA);
		const doc = new JSDOM(response.text).window.document;

		expect(doc.body.classList.contains("variant-a")).toBe(true);
		expect(readSetCookie(response, "hutch_exp")).toBeUndefined();
	});

	it("indexes / whichever arm rendered, with the canonical on / for both", async () => {
		const harness = useAppDrawingArmB(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("index, follow");
		expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
			"https://readplace.com/",
		);
	});

	it("keeps / out of shared caches, since the arm now varies per visitor", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");

		expect(response.headers["cache-control"]).toBe("private, no-cache");
	});

	it("records the exposure on / itself, so an arm with no URL of its own is still counted", async () => {
		const harness = useAppDrawingArmB(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await request(harness.server).get("/").set(BROWSER_REQUEST_HEADERS);

		const pageviews = harness.analytics.events.filter((event) => event.event === "pageview");
		expect(pageviews).toHaveLength(1);
		expect(pageviews[0]).toMatchObject({
			path: "/",
			experiment: "homepage-split-e3",
			experiment_variant: "variant-b",
		});
	});

	it("leaves the exposure off a crawler's pageview, which is not part of the read", async () => {
		const harness = useAppDrawingArmB(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await request(harness.server)
			.get("/")
			.set({ ...BROWSER_REQUEST_HEADERS, "User-Agent": GOOGLEBOT_UA });

		expect(harness.analytics.events).toEqual([]);
	});
});

describe.each(HOMEPAGE_SPLIT.variants.map((variant) => variant.path))(
	"GET %s (the arm's own URL while the split ran client-side)",
	(path) => {
		it("sends the visitor to /, which renders whichever arm they are on", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const response = await request(harness.server).get(path);

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/");
		});
	},
);

describe("GET /", () => {
	it("should return 200 and HTML content", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
	});

	it("should render the hero headline with the full word list for screen readers", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const srOnly = doc.querySelector(".home-hero__title .sr-only");
		expect(srOnly?.textContent).toBe("A home for articles, newsletters, essays, longreads, news, blogs, stories, posts, reports, and interviews.");
	});

	it("should render the visible headline portion aria-hidden with the initial rotator word", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const visible = doc.querySelector(".home-hero__title .hero-headline__visible");
		expect(visible?.getAttribute("aria-hidden")).toBe("true");
		expect(visible?.textContent?.replace(/\s+/g, " ").trim()).toBe("A home for articles");

		const rotator = doc.querySelector(".hero-headline__rotator");
		expect(rotator?.textContent).toBe("articles");
	});

	it("should load the home client bundle via a same-origin script src", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const script = doc.querySelector('script[src="/client-dist/home.client.js"]');
		assert(script, "home.client.js bundle must be loaded on the home page");
		expect(script.hasAttribute("defer")).toBe(true);
	});

	it("should render a generic install CTA when browser is unrecognized", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector('[data-test-cta="install-extension"]');
		expect(cta?.getAttribute("href")).toBe("/install?utm_source=home-hero&utm_medium=internal&utm_content=install");
		expect(cta?.textContent).toBe("Install Browser Extension");
	});

	it("should render Firefox install CTA when User-Agent is Firefox", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/")
			.set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector('[data-test-cta="install-extension"]');
		expect(cta?.textContent).toBe("Install Firefox Extension");
		expect(cta?.getAttribute("href")).toBe("/install?client=firefox&utm_source=home-hero&utm_medium=internal&utm_content=install");

		const trust = doc.querySelector(".home-hero__trust");
		expect(trust?.textContent).toBe("Also on Chrome, iPhone, and your AI assistant.");
	});

	it("should render Chrome install CTA when User-Agent is Chrome", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/")
			.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector('[data-test-cta="install-extension"]');
		expect(cta?.textContent).toBe("Install Chrome Extension");
		expect(cta?.getAttribute("href")).toBe("/install?client=chrome&utm_source=home-hero&utm_medium=internal&utm_content=install");

		const trust = doc.querySelector(".home-hero__trust");
		expect(trust?.textContent).toBe("Also on Firefox, iPhone, and your AI assistant.");
	});

	it("should render Chrome install CTA when User-Agent is Edge", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/")
			.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector('[data-test-cta="install-extension"]');
		expect(cta?.textContent).toBe("Install Chrome Extension");
	});

	it("should render a generic install CTA for iPhone (no extension CTA on the marketing pages)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/")
			.set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector('[data-test-cta="install-extension"]');
		expect(cta?.textContent).toBe("Install Browser Extension");
		expect(cta?.getAttribute("href")).toBe("/install?utm_source=home-hero&utm_medium=internal&utm_content=install");
	});

	it("should render a generic install CTA for Android Chrome (the extension can't install there)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/")
			.set("User-Agent", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector('[data-test-cta="install-extension"]');
		expect(cta?.textContent).toBe("Install Browser Extension");
		expect(cta?.getAttribute("href")).toBe("/install?utm_source=home-hero&utm_medium=internal&utm_content=install");
	});

	it("should render generic trust line when browser is unrecognized", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const trust = doc.querySelector(".home-hero__trust");
		expect(trust?.textContent).toBe("Firefox, Chrome, iPhone, and your AI assistant.");
	});

	it("should render browser-specific bottom install CTA for Firefox", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server)
			.get("/")
			.set("User-Agent", "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0");
		const doc = new JSDOM(response.text).window.document;

		const bottomCta = doc.querySelector('[data-test-cta="bottom-install"]');
		expect(bottomCta?.textContent).toBe("Install Firefox Extension");
		expect(bottomCta?.getAttribute("href")).toBe("/install?client=firefox&utm_source=home-cta&utm_medium=internal&utm_content=install");
	});

	it("should render the public reader-view paste-link form with UTM hidden inputs", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const form = doc.querySelector("[data-test-home-try-form]");
		assert(form, "home try form must be rendered");
		expect(form.getAttribute("method")?.toLowerCase()).toBe("get");
		expect(form.getAttribute("action")).toBe("/view");

		const input = form.querySelector("input[name='url'][data-test-home-try-input]");
		assert(input, "url input must be rendered");
		expect(input.getAttribute("type")).toBe("url");
		expect(input.hasAttribute("required")).toBe(true);

		const utmSource = form.querySelector("input[name='utm_source']");
		expect(utmSource?.getAttribute("value")).toBe("homepage");
		const utmMedium = form.querySelector("input[name='utm_medium']");
		expect(utmMedium?.getAttribute("value")).toBe("internal");
		const utmContent = form.querySelector("input[name='utm_content']");
		expect(utmContent?.getAttribute("value")).toBe("homepage-link-input");

		const submit = form.querySelector("[data-test-home-try-submit]");
		expect(submit?.textContent).toBe("Open in reader view");
	});

	it("should redirect homepage paste-link submissions to /view/<canonical-url> preserving UTM on the logged pageview", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(
			"/view?url=https%3A%2F%2Fexample.com%2Farticle&utm_source=homepage&utm_medium=internal&utm_content=homepage-link-input",
		);
		expect(response.status).toBe(302);
		expect(response.headers.location).toBe("/view/example.com/article");
	});

	it("should render the secondary CTA linking to GitHub", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const cta = doc.querySelector('[data-test-cta="view-github"]');
		expect(cta?.getAttribute("href")).toBe("https://github.com/Readplace/readplace.com");
		expect(cta?.textContent).toBe("View on GitHub");
	});

	it("should render the core features section with shipped features only", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const coreSection = doc.querySelector('[data-test-section="core-features"]');
		const features = coreSection?.querySelectorAll("[data-test-feature]");
		expect(features?.length).toBe(6);
	});

	it("links the MCP feature to the /mcp connection guide", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const mcpLink = doc.querySelector('[data-test-feature-link="Connect Your AI Assistant"]');
		expect(mcpLink?.getAttribute("href")).toBe("/mcp");
	});

	it("links the content-capture feature to /install and names the iPhone, not just the browser extension", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const feature = doc.querySelector('[data-test-feature="Save the Full Page"]');
		assert(feature, "content-capture feature card must be rendered");
		expect(feature.textContent?.toLowerCase()).toContain("iphone");

		const installLink = doc.querySelector('[data-test-feature-link="Save the Full Page"]');
		expect(installLink?.getAttribute("href")).toBe("/install");
	});

	it("lists every shipped way to save, each with its own link", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const section = doc.querySelector('[data-test-section="ways-to-save"]');
		assert(section, "ways-to-save section must be rendered");

		const names = Array.from(section.querySelectorAll("[data-test-way]")).map((el) =>
			el.getAttribute("data-test-way"),
		);
		expect(names).toEqual([
			"Paste a link on this page",
			"Chrome, Edge, or Brave",
			"Firefox",
			"Your iPhone",
			"ChatGPT, Claude, or Gemini",
			"A file, or a page full of links",
			"Your newsletters",
			"A save button on your own site",
		]);

		const hrefs = Array.from(section.querySelectorAll("[data-test-way-link]")).map((el) =>
			el.getAttribute("href"),
		);
		expect(hrefs).toEqual([
			"#paste-a-link",
			"/install?client=chrome&utm_source=home-ways&utm_medium=internal&utm_content=chrome",
			"/install?client=firefox&utm_source=home-ways&utm_medium=internal&utm_content=firefox",
			"/install?client=iphone&utm_source=home-ways&utm_medium=internal&utm_content=iphone",
			"/mcp?utm_source=home-ways&utm_medium=internal&utm_content=mcp",
			"/import?utm_source=home-ways&utm_medium=internal&utm_content=import",
			"/blog/save-newsletter-links-to-your-queue?utm_source=home-ways&utm_medium=internal&utm_content=inbox",
			"/embed?utm_source=home-ways&utm_medium=internal&utm_content=embed",
		]);
	});

	it("anchors the hero and the closing CTA at the ways-to-save list", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.querySelector('[data-test-cta="hero-ways"]')?.getAttribute("href")).toBe(
			"#ways-to-save",
		);
		expect(doc.querySelector('[data-test-cta="bottom-ways"]')?.getAttribute("href")).toBe(
			"#ways-to-save",
		);
		// The first way links back to the paste box, so that fragment must resolve too.
		expect(doc.querySelector('[data-test-section="try"]')?.getAttribute("id")).toBe(
			"paste-a-link",
		);
	});

	it("should render one demo video per browser extension", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const demoSection = doc.querySelector('[data-test-section="demo"]');
		const videoLabels = demoSection?.querySelectorAll(".home-demo__video-label");
		const labels = Array.from(videoLabels ?? []).map((el) => el.textContent);
		expect(labels).toEqual(["Chrome", "Firefox"]);
	});

	it("should reserve each demo video's box and leave it click-to-play", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const videos = Array.from(
			doc.querySelectorAll('[data-test-section="demo"] .home-demo__video'),
		);
		expect(videos).toHaveLength(2);
		for (const video of videos) {
			expect(video.getAttribute("width")).toBe("1280");
			expect(video.getAttribute("height")).toBe("800");
			expect(video.getAttribute("preload")).toBe("none");
			expect(video.hasAttribute("controls")).toBe(true);
			expect(video.hasAttribute("autoplay")).toBe(false);
			expect(video.hasAttribute("loop")).toBe(false);
			expect(video.getAttribute("poster")).toMatch(/save-demo-poster\.webp$/);
			const sources = Array.from(video.querySelectorAll("source")).map((s) => s.getAttribute("type"));
			expect(sources).toEqual(["video/mp4"]);
		}
	});

	it("should render the backstory section", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const backstory = doc.querySelector('[data-test-section="backstory"]');
		assert(backstory, "backstory section must be rendered");
		expect(backstory.getAttribute("aria-label")).toBe("About the creator");
		expect(backstory.querySelector(".home-backstory__title")?.textContent).toBe(
			"I believe we can fix the web",
		);
	});

	it("should render the highlighted reader testimonial after the hero", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const testimonial = doc.querySelector('[data-test-section="testimonial"]');
		assert(testimonial, "testimonial section must be rendered");
		expect(testimonial.getAttribute("aria-label")).toBe("What readers say");

		const quote = testimonial.querySelector(".home-testimonial__quote");
		expect(quote?.textContent).toContain("it just works");

		const attribution = testimonial.querySelector(".home-testimonial__attribution");
		expect(attribution?.textContent).toContain("Matthew Motz");
		expect(attribution?.textContent).toContain("early user");

		const hero = doc.querySelector('[data-test-section="hero"]');
		assert(hero, "hero section must be rendered");
		expect(
			hero.compareDocumentPosition(testimonial) & hero.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("renders the founding card as the ONLY plan in the DOM when under the limit — a CSS-hidden paid card would leak into the markdown/crawler view", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const plans = Array.from(doc.querySelectorAll("[data-test-plan]")).map((el) =>
			el.getAttribute("data-test-plan"),
		);
		expect(plans).toEqual(["founding"]);

		const founding = doc.querySelector('[data-test-plan="founding"]');
		assert(founding, "founding pricing card must be rendered");
		expect(founding.querySelector(".pricing-card__name")?.textContent).toBe("Founding Member");
		expect(founding.querySelector(".pricing-card__price")?.textContent).toContain("$0");

		const grid = founding.closest(".pricing-grid");
		assert(grid, "pricing-grid wrapper must be rendered");
		expect(grid.classList.contains("pricing-grid--visible")).toBe(true);

		const fallback = doc.querySelector(".home-pricing__fallback");
		assert(fallback, "fallback wrapper must be rendered");
		expect(fallback.classList.contains("home-pricing__fallback--hidden")).toBe(true);
	});

	it("should render the founding pricing title when under the limit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const title = doc.querySelector('[data-test-pricing-title] .section-header__title');
		expect(title?.textContent).toBe(`Free for the first ${TEST_FOUNDING_MEMBER_LIMIT} members.`);
	});

	it("should render the founding members progress bar with zero users", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const progress = doc.querySelector("[data-test-founding-progress]");
		const label = progress?.querySelector(".founding-progress__label");
		expect(label?.textContent).toBe(`0 / ${TEST_FOUNDING_MEMBER_LIMIT} founding members`);

		const fill = progress?.querySelector(".founding-progress__fill");
		expect(fill?.getAttribute("style")).toBe("width: 0%");
	});


	it("should render the comparison table", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const table = doc.querySelector("[data-test-comparison-table]");
		const rows = table?.querySelectorAll("tbody tr");
		expect(rows?.length).toBe(5);
	});

	it("should render the trust section with three trust items", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const trustSection = doc.querySelector('[data-test-section="trust"]');
		const cards = trustSection?.querySelectorAll(".trust-card");
		expect(cards?.length).toBe(3);
	});

	it("should render the canonical disambiguation section explaining extension capture vs link submission", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const section = doc.querySelector('[data-test-section="canonical"]');
		assert(section, "canonical disambiguation section must be rendered");
		expect(section.querySelector(".home-canonical__heading")?.textContent).toContain("Same article");
		const body = section.textContent ?? "";
		expect(body).toContain("DeepSeek");
		expect(body).toContain("extension");
		expect(body).toContain("canonical");
	});

	it("should render the decline statements section listing what Readplace will not become", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const section = doc.querySelector('[data-test-section="decline"]');
		assert(section, "decline statements section must be rendered");
		const items = section.querySelectorAll("[data-test-decline-list] .home-decline__item");
		expect(items.length).toBe(4);
		const itemTexts = Array.from(items).map((el) => el.textContent?.trim());
		expect(itemTexts).toContain("Nested folder hierarchies");
	});

	it("should render the cost transparency section naming the paid pipeline providers", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const section = doc.querySelector('[data-test-section="cost-transparency"]');
		assert(section, "cost transparency section must be rendered");
		expect(section.querySelector(".home-cost__heading")?.textContent).toContain(
			"And that's why I need your help",
		);
		expect(section.querySelector(".home-cost__subtitle")?.textContent).toContain("$4.08");
		const items = section.querySelectorAll("[data-test-cost-list] .home-cost__item");
		expect(items.length).toBe(3);
		const providerNames = Array.from(
			section.querySelectorAll("[data-test-cost-list] .home-cost__item strong"),
		).map((el) => el.textContent?.trim());
		expect(providerNames).toEqual([
			"Mozilla Readability",
			"Real Tesseract OCR",
			"DeepSeek V4",
		]);
		const text = section.textContent ?? "";
		expect(text).toContain("no data resale");
	});

	it("should render the failure-mode paragraph inside the backstory", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const para = doc.querySelector("[data-test-failure-mode]");
		assert(para, "failure-mode paragraph must be rendered");
		const text = para.textContent ?? "";
		expect(text).toContain("GitHub");
		expect(text).toContain("Sydney");
		expect(text).toContain("self-host");
	});


	it("should have page-home body class", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.body.classList.contains("page-home")).toBe(true);
	});

	it("should set appropriate SEO metadata", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.title).toContain("Readplace");
		expect(doc.title).toContain("The #1 Personal Reading List");
		expect(doc.title).toContain("Read It Later");
		// The title has to carry the slogan and the query people actually search
		// within the ~60 characters Google renders before truncating.
		expect(doc.title.length).toBeLessThanOrEqual(60);
		const description = doc.querySelector('meta[name="description"]');
		expect(description?.getAttribute("content")).toContain("Read what you saved");
		expect(description?.getAttribute("content")).toContain("no signup");
		expect(description?.getAttribute("content")).toContain("Pocket alternative");

		const keywords = doc.querySelector('meta[name="keywords"]');
		expect(keywords?.getAttribute("content")).toContain("personal reading list");
		expect(keywords?.getAttribute("content")).toContain("no LLM hallucination");
		expect(keywords?.getAttribute("content")).toContain("real OCR");
	});

	it("should render the 'The #1 Personal Reading List.' tagline as the hero heading", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const tagline = doc.querySelector("[data-test-tagline]");
		assert(tagline, "tagline must be rendered");
		expect(tagline.textContent?.trim()).toBe("The #1 Personal Reading List.");
	});

	it("renders the canonical slogan so a crawler and a no-JavaScript reader see the one the title claims", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const tagline = doc.querySelector("[data-test-tagline]");
		assert(tagline, "tagline must be rendered");
		expect(tagline.textContent?.trim()).toBe(CANONICAL_SLOGAN);
	});

	it("carries the whole slogan list on the heading, so the rotator holds no second copy to drift", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const tagline = doc.querySelector("[data-test-tagline]");
		assert(tagline, "tagline must be rendered");
		const raw = tagline.getAttribute("data-slogans");
		assert(raw, "the heading must carry the slogan list the rotator reads");
		// Parsed, not string-compared: the attribute is HTML-escaped in the markup
		// and only has to survive the browser decoding it back.
		expect(JSON.parse(raw)).toEqual([...SLOGANS]);
	});

	it("should render the correctness-over-hallucination emphasis paragraph in the cost transparency section", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const para = doc.querySelector("[data-test-no-hallucination]");
		assert(para, "correctness-over-hallucination emphasis paragraph must be rendered");
		const text = para.textContent ?? "";
		expect(text).toContain("correctness over hallucination");
		expect(text).toContain("No AI generated slop");
		expect(text).toContain("Tesseract");
		expect(text).toContain("What you read is what was on the page");
	});

	it("should include author and keywords meta tags", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const author = doc.querySelector('meta[name="author"]');
		expect(author?.getAttribute("content")).toBe("Fayner Brack");

		const keywords = doc.querySelector('meta[name="keywords"]');
		expect(keywords?.getAttribute("content")).toContain("Pocket alternative");
	});

	it("should include Open Graph image alt text", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const ogImageAlt = doc.querySelector('meta[property="og:image:alt"]');
		expect(ogImageAlt?.getAttribute("content")).toContain("Readplace");
	});

	it("should not include twitter:site when no handle is configured", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const twitterMetaNames = Array.from(
			doc.querySelectorAll('meta[name^="twitter:"]'),
		).map((meta) => meta.getAttribute("name"));
		expect(twitterMetaNames).toEqual([
			"twitter:card",
			"twitter:title",
			"twitter:description",
			"twitter:image",
			"twitter:creator",
		]);
	});

	it("should include multiple structured data schemas", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
		const schemas = Array.from(scripts).map((s) => JSON.parse(s.textContent ?? "{}"));

		const types = schemas.map((s: { "@type": string }) => s["@type"]);
		expect(types).toEqual(["WebApplication", "Organization", "FAQPage", "WebSite"]);
	});

	it("should link the Organization to the App Store listing and offer the Smart App Banner", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const schemas = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map(
			(s) => JSON.parse(s.textContent ?? "{}"),
		);
		const organization = schemas.find((s: { "@type": string }) => s["@type"] === "Organization");
		expect(organization.sameAs).toContain("https://apps.apple.com/app/readplace/id6777107238");

		expect(doc.querySelector('meta[name="apple-itunes-app"]')?.getAttribute("content")).toBe(
			"app-id=6777107238",
		);
	});

	it("should include FAQ structured data with questions and answers", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
		const schemas = Array.from(scripts).map((s) => JSON.parse(s.textContent ?? "{}"));
		const faq = schemas.find((s: { "@type": string }) => s["@type"] === "FAQPage");

		expect(faq.mainEntity.length).toBe(6);
		expect(faq.mainEntity[0].name).toBe("What is Readplace?");
		expect(faq.mainEntity[4].name).toBe("What does the $4.08/month subscription pay for?");
		expect(faq.mainEntity[5].name).toBe("Does Readplace hallucinate text when extracting PDFs?");
	});

	it("should advertise the free founding tier in structured data while founding seats remain", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
		const schemas = Array.from(scripts).map((s) => JSON.parse(s.textContent ?? "{}"));
		const app = schemas.find((s: { "@type": string }) => s["@type"] === "WebApplication");

		expect(app.isAccessibleForFree).toBe(true);
		const offerNames = app.offers.map((offer: { name: string }) => offer.name);
		expect(offerNames).toEqual(["Founding Member", "Standard"]);

		const faq = schemas.find((s: { "@type": string }) => s["@type"] === "FAQPage");
		const freeQuestion = faq.mainEntity.find(
			(q: { name: string }) => q.name === "Is Readplace free?",
		);
		expect(freeQuestion.acceptedAnswer.text).toContain("founding members get full access free");
	});

	it("should include the reader review nested in the WebApplication structured data", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
		const schemas = Array.from(scripts).map((s) => JSON.parse(s.textContent ?? "{}"));
		const app = schemas.find((s: { "@type": string }) => s["@type"] === "WebApplication");

		assert(app.review, "WebApplication schema must include a review");
		expect(app.review["@type"]).toBe("Review");
		expect(app.review.author.name).toBe("Matthew Motz");
		expect(app.review.reviewBody).toContain("it just works");
		expect(app.review.reviewRating.ratingValue).toBe("5");
	});

	it("should render section landmarks with aria-labels", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const hero = doc.querySelector('[data-test-section="hero"]');
		expect(hero?.getAttribute("aria-label")).toBe("Introduction");

		const pricing = doc.querySelector('[data-test-section="pricing"]');
		expect(pricing?.getAttribute("aria-label")).toBe("Pricing");
	});

	it("should use scope attributes on comparison table headers", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const colHeaders = doc.querySelectorAll('[data-test-comparison-table] thead th[scope="col"]');
		expect(colHeaders.length).toBe(6);

		const rowHeaders = doc.querySelectorAll('[data-test-comparison-table] tbody th[scope="row"]');
		expect(rowHeaders.length).toBe(5);
	});
});
