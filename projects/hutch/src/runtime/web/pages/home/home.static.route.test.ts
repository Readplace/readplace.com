import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../../test-app";
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

		expect(doc.querySelector("[data-test-founding-progress]")).toBeNull();
	}, 30000);

	it("should hide the founding pricing card and show the fallback benefits + CTA when over the limit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;

		for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
			await auth.createUser({ email: `over${i}@test.com`, password: "password123" });
		}

		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		const founding = doc.querySelector('[data-test-plan="founding"]');
		assert(founding, "founding pricing card must be rendered");
		const grid = founding.closest(".pricing-grid");
		assert(grid, "pricing-grid wrapper must be rendered");
		expect(grid.classList.contains("pricing-grid--hidden")).toBe(true);

		const fallback = doc.querySelector(".home-pricing__fallback");
		assert(fallback, "fallback wrapper must be rendered");
		expect(fallback.classList.contains("home-pricing__fallback--visible")).toBe(true);

		const benefits = fallback.querySelector("[data-test-fallback-benefits]");
		assert(benefits, "fallback benefits list must be rendered");
		expect(benefits.querySelectorAll(".pricing-card__feature").length).toBe(6);
		expect(fallback.querySelector('[data-test-cta="become-member"]')).not.toBeNull();
	}, 30000);

	it("should hide the founding pricing title when over the limit", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { auth } = harness;

		for (let i = 0; i < TEST_FOUNDING_MEMBER_LIMIT; i++) {
			await auth.createUser({ email: `title${i}@test.com`, password: "password123" });
		}

		const response = await request(harness.server).get("/");
		const doc = new JSDOM(response.text).window.document;

		expect(doc.querySelector("[data-test-pricing-title]")).toBeNull();
		expect(response.text).not.toContain(`Free for the first ${TEST_FOUNDING_MEMBER_LIMIT} members.`);
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

	it("declares the same Content-Signal policy as the HTTP header", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/robots.txt");
		expect(response.text).toContain("Content-Signal: search=yes, ai-input=yes, ai-train=no");
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

		const urls = Array.from(response.text.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);
		// Blog URLs are served from blog-site's own /blog/sitemap.xml (a separate
		// deployable), advertised via a second Sitemap line in robots.txt.
		expect(urls).toEqual([
			"http://localhost:3000/",
			"http://localhost:3000/install",
			"http://localhost:3000/login",
			"http://localhost:3000/signup",
			"http://localhost:3000/privacy",
			"http://localhost:3000/terms",
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
			revocation_endpoint: "http://localhost:3000/oauth/revoke",
			response_types_supported: ["code"],
			grant_types_supported: ["authorization_code", "refresh_token"],
			token_endpoint_auth_methods_supported: ["none"],
			code_challenge_methods_supported: ["S256"],
			agent_auth: {
				skill: "http://localhost:3000/auth.md",
				register_uri: "mailto:readplace+agents@readplace.com",
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
				`http://localhost:3000/.well-known/agent-skills/${skill.name}/SKILL.md`,
			);
			expect(skill.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
		}
	});

	it("serves each listed SKILL.md as markdown with a digest matching its sha256", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const index = await request(harness.server).get("/.well-known/agent-skills/index.json");

		for (const skill of index.body.skills) {
			const artifactPath = new URL(skill.url).pathname;
			const artifact = await request(harness.server).get(artifactPath);
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
