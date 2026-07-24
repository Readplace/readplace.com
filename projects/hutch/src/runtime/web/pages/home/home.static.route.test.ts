import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";

const TEST_FOUNDING_MEMBER_LIMIT = 3;

const useApp = useTestServer();

describe("GET / with exhausted founding allocation", () => {
	it("should hide the founding progress when users exceed the limit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;

		for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
			await auth.createUser({ email: `user${i}@test.com`, password: "password123" });
		}

		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const progressSlot = doc.querySelector("[data-test-founding-progress-slot]");
		assert(progressSlot, "founding progress slot must be rendered");
		expect(progressSlot.classList.contains("home-pricing__progress--hidden")).toBe(true);
	}, 30000);

	it("renders the standard plan card as the ONLY plan when over the limit — price, trial, benefits + CTA, with no CSS-hidden founding card leaking into the markdown/crawler view", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;

		for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
			await auth.createUser({ email: `over${i}@test.com`, password: "password123" });
		}

		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const plans = Array.from(doc.querySelectorAll("[data-test-plan]")).map((el) =>
			el.getAttribute("data-test-plan"),
		);
		expect(plans).toEqual(["standard"]);

		const grid = doc.querySelector(".pricing-grid");
		assert(grid, "pricing-grid wrapper must be rendered");
		expect(grid.classList.contains("pricing-grid--hidden")).toBe(true);

		const fallback = doc.querySelector(".home-pricing__fallback");
		assert(fallback, "fallback wrapper must be rendered");
		expect(fallback.classList.contains("home-pricing__fallback--visible")).toBe(true);

		const standardCard = fallback.querySelector('[data-test-plan="standard"]');
		assert(standardCard, "standard plan card must be rendered in the fallback");
		expect(standardCard.querySelector(".pricing-card__name")?.textContent).toBe(
			"Readplace Membership",
		);
		expect(standardCard.querySelector(".pricing-card__price")?.textContent).toBe("$4.08/month");
		expect(standardCard.querySelector(".pricing-card__badge")?.textContent).toBe(
			"14-day free trial",
		);
		expect(standardCard.querySelector(".pricing-card__description")?.textContent).toBe(
			"Try everything free for 14 days. No credit card required to start.",
		);

		const benefits = standardCard.querySelector("[data-test-fallback-benefits]");
		assert(benefits, "fallback benefits list must be rendered");
		expect(benefits.querySelectorAll(".pricing-card__feature").length).toBe(6);
		const becomeMemberCta = standardCard.querySelector('[data-test-cta="become-member"]');
		assert(becomeMemberCta, "become-member CTA must be rendered");
		expect(becomeMemberCta.getAttribute("href")).toBe(
			"/signup?utm_source=homepage&utm_medium=internal&utm_content=signup-body",
		);
	}, 30000);

	it("stops advertising a free tier in structured data once the founding allocation is exhausted", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;

		for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
			await auth.createUser({ email: `schema${i}@test.com`, password: "password123" });
		}

		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
		const schemas = Array.from(scripts).map((s) => JSON.parse(s.textContent ?? "{}"));

		const app = schemas.find((s: { "@type": string }) => s["@type"] === "WebApplication");
		assert(app, "WebApplication schema must be rendered");
		expect(app.isAccessibleForFree).toBe(false);
		const offerNames = app.offers.map((offer: { name: string }) => offer.name);
		expect(offerNames).toEqual(["Standard"]);

		const faq = schemas.find((s: { "@type": string }) => s["@type"] === "FAQPage");
		assert(faq, "FAQPage schema must be rendered");
		expect(faq.mainEntity.length).toBe(6);
		const freeQuestion = faq.mainEntity.find(
			(q: { name: string }) => q.name === "Is Readplace free?",
		);
		assert(freeQuestion, "the 'Is Readplace free?' question must still be present");
		expect(freeQuestion.acceptedAnswer.text).toContain("14-day free trial");
		expect(freeQuestion.acceptedAnswer.text).not.toContain("free, forever");
	}, 30000);

	it("should hide the founding pricing title when over the limit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;

		for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
			await auth.createUser({ email: `title${i}@test.com`, password: "password123" });
		}

		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const pricingTitle = doc.querySelector("[data-test-pricing-title]");
		assert(pricingTitle, "pricing title must be rendered");
		expect(pricingTitle.classList.contains("home-pricing__title--hidden")).toBe(true);
	}, 30000);
});

describe("GET /favicon.ico", () => {
	it("should 301 redirect to the static CDN's favicon.ico", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/favicon.ico");
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe("https://static.test/favicon.ico");
	});
});

describe("GET /apple-touch-icon*.png", () => {
	it.each([
		"/apple-touch-icon.png",
		"/apple-touch-icon-precomposed.png",
		"/apple-touch-icon-57x57.png",
		"/apple-touch-icon-180x180.png",
	])("should 301 redirect %s to the static CDN", async (path) => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get(path);
		expect(response.status).toBe(301);
		expect(response.headers.location).toBe(`https://static.test${path}`);
	});

	it("should fall through to 404 for paths that don't match the apple-touch-icon shape", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/apple-touch-icon-invalid.png");
		expect(response.status).toBe(404);
	});
});

describe("GET /robots.txt", () => {
	it("should return a text response with crawl directives", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/robots.txt");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/plain/);
		expect(response.text).toContain("User-agent: *");
		expect(response.text).toContain("Allow: /");
		expect(response.text).toContain("Disallow: /queue");
		expect(response.text).toContain("Sitemap: http://localhost:3000/sitemap.xml");
	});

	it("advertises blog-site's sitemap so blog posts stay crawlable after the extraction", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/robots.txt");
		expect(response.text).toContain("Sitemap: http://localhost:3000/blog/sitemap.xml");
	});

	it("declares only the origin-wide Content-Signal values, leaving ai-train to per-path headers", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/robots.txt");
		expect(response.text).toContain("Content-Signal: search=yes, ai-input=yes");
		expect(response.text).not.toContain("ai-train");
	});

	it("keeps /view crawlable for search engines but disallows it for AI crawlers", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/robots.txt");

		const groups = response.text.split("\n\n").map((group: string) => group.split("\n"));
		const defaultGroup = groups.find((lines: string[]) => lines[0] === "User-agent: *");
		assert.ok(defaultGroup, "robots.txt must have a default group");
		expect(defaultGroup).not.toContain("Disallow: /view");

		for (const agent of ["GPTBot", "ClaudeBot", "PerplexityBot", "CCBot"]) {
			const group = groups.find((lines: string[]) => lines[0] === `User-agent: ${agent}`);
			assert.ok(group, `robots.txt must have a group for ${agent}`);
			expect(group).toContain("Disallow: /view");
			expect(group).toContain("Disallow: /queue");
		}
	});

	it("opens the shared queue permalinks so crawlers can follow the redirect to /view's noindex", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/robots.txt");
		expect(response.text).toContain("Allow: /queue/*/view$");
		expect(response.text).toContain("Allow: /queue/*/view?");
		expect(response.text).toContain("Allow: /queue/*/read$");
		expect(response.text).toContain("Allow: /queue/*/read?");
	});

	it("never disallows the blog", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/robots.txt");
		expect(response.text).not.toContain("Disallow: /blog");
	});

	it("has no Googlebot group so Googlebot falls back to the default rules", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/robots.txt");
		expect(response.text).not.toContain("User-agent: Googlebot");
	});
});

describe("GET /site.webmanifest", () => {
	it("serves a same-origin manifest with the manifest MIME type", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/site.webmanifest");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/application\/manifest\+json/);
	});

	it("keeps start_url root-relative and stamps icon srcs absolute to the static CDN", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/site.webmanifest");
		const manifest = JSON.parse(response.text);
		expect(manifest.start_url).toBe("/");
		for (const icon of manifest.icons) {
			expect(icon.src.startsWith("https://static.test/")).toBe(true);
		}
	});
});

describe("GET /llms.txt", () => {
	it("should return a text response with the product overview", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/llms.txt");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/plain/);
		expect(response.text).toContain("# Readplace");
		expect(response.text).toContain("read-it-later");
		expect(response.text).toContain("## Pages");
	});

	it("advertises the markdown content-negotiation capability", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/llms.txt");
		expect(response.text).toContain("Accept: text/markdown");
	});
});

describe("GET / with Accept: text/markdown", () => {
	it("returns 200 with text/markdown content-type instead of redirecting to /queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/").set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(response.headers.location).toBeUndefined();
	});

	it("redirects a logged-in visitor to /queue instead of serving the markdown landing page", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;
		const agent = await loginAgent(harness.server, auth);

		const response = await agent.get("/").set("Accept", "text/markdown");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
	});

	it("converts the comparison table into markdown table syntax", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/").set("Accept", "text/markdown");

		expect(response.text).toMatch(/\|\s+-+\s+\|/);
	});

	it("emits the Content-Signal policy and Vary: Accept", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/").set("Accept", "text/markdown");

		expect(response.headers["content-signal"]).toBe(
			"search=yes, ai-input=yes, ai-train=no",
		);
		expect(response.headers.vary).toMatch(/\bAccept\b/);
	});
});

describe("GET / HTML response gains the Content-Signal header", () => {
	it("sets the site-wide Content-Signal policy on plain HTML GETs", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");

		expect(response.headers["content-signal"]).toBe(
			"search=yes, ai-input=yes, ai-train=no",
		);
		expect(response.headers.vary).toMatch(/\bAccept\b/);
	});
});

describe("GET /llms-full.txt", () => {
	it("should return a text response with the full product details", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/llms-full.txt");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/plain/);
		expect(response.text).toContain("# Readplace");
		expect(response.text).toContain("## Features");
		expect(response.text).toContain("## About");
		expect(response.text).toContain("## Privacy");
	});
});

describe("GET /auth.md", () => {
	it("serves the agent registration recipe as markdown", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/auth.md");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/markdown/);
		expect(response.text.startsWith("# auth.md")).toBe(true);
	});

	it("documents the real OAuth endpoints against the configured base URL", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/auth.md");
		expect(response.text).not.toContain("{{baseUrl}}");
		expect(response.text).toContain("http://localhost:3000/oauth/authorize");
		expect(response.text).toContain("http://localhost:3000/.well-known/oauth-protected-resource");
	});
});

describe("GET /sitemap.xml", () => {
	it("should return an XML sitemap with exactly the public pages", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/sitemap.xml");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/application\/xml/);

		const sitemapDoc = new JSDOM(response.text, { contentType: "text/xml" }).window.document;
		const urls = Array.from(sitemapDoc.querySelectorAll("loc")).map((loc) => loc.textContent);
		// Blog URLs are served from blog-site's own /blog/sitemap.xml (a separate
		// deployable), advertised via a second Sitemap line in robots.txt.
		expect(urls).toEqual([
			"http://localhost:3000/",
			"http://localhost:3000/install",
			"http://localhost:3000/import",
			"http://localhost:3000/pocket-alternative",
			"http://localhost:3000/pdf-ocr",
			"http://localhost:3000/ai-reading-list",
			"http://localhost:3000/read-it-later-that-wont-die",
			"http://localhost:3000/embed",
			"http://localhost:3000/login",
			"http://localhost:3000/signup",
			"http://localhost:3000/llms.txt",
			"http://localhost:3000/llms-full.txt",
			"http://localhost:3000/auth.md",
		]);
	});
});

describe("GET / Link header (RFC 9727 api-catalog discovery)", () => {
	it("advertises the api-catalog so agents can find the well-known entry point", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/");
		expect(response.headers.link).toBe('</.well-known/api-catalog>; rel="api-catalog"');
	});
});

describe("GET /health", () => {
	it("returns an ok status as JSON", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/health");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/application\/json/);
		expect(response.body).toEqual({ status: "ok" });
	});
});

describe("GET /.well-known/oauth-authorization-server", () => {
	it("publishes RFC 8414 metadata for the OAuth 2.0 authorization server", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/.well-known/oauth-authorization-server");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/application\/json/);
		expect(response.body).toEqual({
			issuer: "http://localhost:3000",
			authorization_endpoint: "http://localhost:3000/oauth/authorize",
			token_endpoint: "http://localhost:3000/oauth/token",
			registration_endpoint: "http://localhost:3000/oauth/register",
			revocation_endpoint: "http://localhost:3000/oauth/revoke",
			response_types_supported: ["code"],
			grant_types_supported: ["authorization_code", "refresh_token"],
			token_endpoint_auth_methods_supported: ["none"],
			code_challenge_methods_supported: ["S256"],
			agent_auth: {
				skill: "http://localhost:3000/auth.md",
				register_uri: "http://localhost:3000/oauth/register",
				identity_types_supported: ["delegated_user"],
				credential_types_supported: ["oauth2_access_token", "oauth2_refresh_token"],
				revocation_uri: "http://localhost:3000/oauth/revoke",
				registration_methods: [
					{
						type: "oauth2_authorization_code_pkce",
						authorization_uri: "http://localhost:3000/oauth/authorize",
						token_uri: "http://localhost:3000/oauth/token",
						grant_types_supported: ["authorization_code", "refresh_token"],
						code_challenge_methods_supported: ["S256"],
						token_endpoint_auth_methods_supported: ["none"],
					},
				],
			},
		});
	});
});

describe("GET /.well-known/oauth-protected-resource", () => {
	it("publishes RFC 9728 metadata pointing at the authorization server", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/.well-known/oauth-protected-resource");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/application\/json/);
		expect(response.body).toEqual({
			resource: "http://localhost:3000",
			resource_name: "Readplace",
			authorization_servers: ["http://localhost:3000"],
			scopes_supported: ["queue"],
			bearer_methods_supported: ["header"],
			resource_documentation: "http://localhost:3000/auth.md",
		});
	});
});

describe("GET /.well-known/api-catalog", () => {
	it("publishes an RFC 9727 linkset pointing at real, fetchable resources", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/.well-known/api-catalog");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/application\/linkset\+json/);

		const catalog = JSON.parse(response.text);
		expect(catalog.linkset).toHaveLength(1);
		const entry = catalog.linkset[0];
		expect(entry.anchor).toBe("http://localhost:3000");
		expect(entry["service-doc"][0].href).toBe("http://localhost:3000/llms-full.txt");
		expect(entry["service-meta"][0].href).toBe(
			"http://localhost:3000/.well-known/oauth-protected-resource",
		);
		expect(entry.status[0].href).toBe("http://localhost:3000/health");
	});
});

describe("GET /.well-known/agent-skills/index.json", () => {
	it("publishes an Agent Skills Discovery RFC v0.2.0 index", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/.well-known/agent-skills/index.json");
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/application\/json/);
		expect(response.body.$schema).toBe(
			"https://schemas.agentskills.io/discovery/0.2.0/schema.json",
		);
		expect(Array.isArray(response.body.skills)).toBe(true);
		expect(response.body.skills.length).toBeGreaterThan(0);
		for (const skill of response.body.skills) {
			expect(typeof skill.name).toBe("string");
			expect(skill.type).toBe("skill-md");
			expect(typeof skill.description).toBe("string");
			expect(skill.url).toBe(
				`/.well-known/agent-skills/${skill.name}/SKILL.md`,
			);
			expect(skill.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
		}
	});

	it("serves each listed SKILL.md as markdown with a digest matching its sha256", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const index = await request(harness.server).get("/.well-known/agent-skills/index.json");

		for (const skill of index.body.skills) {
			const artifact = await request(harness.server).get(skill.url);
			expect(artifact.status).toBe(200);
			expect(artifact.headers["content-type"]).toMatch(/text\/markdown/);
			const digest = `sha256:${createHash("sha256").update(Buffer.from(artifact.text, "utf-8")).digest("hex")}`;
			expect(digest).toBe(skill.digest);
		}
	});
});

describe("GET /nonexistent", () => {
	it("should return 404", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/nonexistent");
		expect(response.status).toBe(404);
	});
});
