import { JSDOM } from "jsdom";
import request from "supertest";
import { loginAgent, useTestServer } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();

const CANONICAL_URL = "https://readplace.com/developers";

const DESCRIPTION =
	"Register an OAuth client, discover the Siren API from one URL, then save, list, read and file a reader's articles.";

async function loadPage(): Promise<Document> {
	const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
	const response = await request(harness.server).get("/developers").set("Accept", "text/html");
	return new JSDOM(response.text).window.document;
}

function structuredData(doc: Document) {
	return Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map((script) =>
		JSON.parse(script.textContent ?? ""),
	);
}

describe("/developers SEO", () => {
	it("keeps the API page out of search on its own canonical", async () => {
		const doc = await loadPage();

		expect({
			robots: doc.querySelector('meta[name="robots"]')?.getAttribute("content"),
			canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute("href"),
			title: doc.title,
			description: doc.querySelector('meta[name="description"]')?.getAttribute("content"),
		}).toEqual({
			robots: "noindex",
			canonical: CANONICAL_URL,
			title: "Build on the Readplace API — Readplace",
			description: DESCRIPTION,
		});
	});

	it("describes the page with one WebPage block", async () => {
		const doc = await loadPage();

		expect(structuredData(doc)).toEqual([
			{
				"@context": "https://schema.org",
				"@type": "WebPage",
				"@id": CANONICAL_URL,
				name: "Build on the Readplace API",
				url: CANONICAL_URL,
				description: DESCRIPTION,
				isPartOf: { "@type": "WebSite", name: "Readplace", url: "https://readplace.com" },
				about: { "@id": "https://readplace.com/#app" },
			},
		]);
	});

	it("is listed and linked by none of the surfaces that list Readplace's pages", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);
		const signedOutPaths = [
			"/sitemap.xml",
			"/llms.txt",
			"/llms-full.txt",
			"/.well-known/api-catalog",
			"/auth.md",
			"/.well-known/agent-skills/index.json",
			"/.well-known/agent-skills/save-to-readplace/SKILL.md",
			"/mcp",
			"/",
		];
		const signedInPaths = ["/mcp", "/queue"];

		const mentionsOf = (response: request.Response) => response.text.split("/developers").length - 1;
		const surfaces = [];
		for (const path of signedOutPaths) {
			const response = await request(harness.server).get(path);
			surfaces.push({ path, signedIn: false, status: response.status, mentions: mentionsOf(response) });
		}
		for (const path of signedInPaths) {
			const response = await agent.get(path);
			surfaces.push({ path, signedIn: true, status: response.status, mentions: mentionsOf(response) });
		}

		expect(surfaces).toEqual([
			...signedOutPaths.map((path) => ({ path, signedIn: false, status: 200, mentions: 0 })),
			...signedInPaths.map((path) => ({ path, signedIn: true, status: 200, mentions: 0 })),
		]);
	});
});
