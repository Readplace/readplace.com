import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import { useTestServer } from "../../../test-app";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";

const useApp = useTestServer();

const CANONICAL_URL = "https://readplace.com/mcp";

async function loadGuide(): Promise<Document> {
	const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
	const response = await request(harness.server).get("/mcp").set("Accept", "text/html");
	return new JSDOM(response.text).window.document;
}

function structuredData(doc: Document) {
	return Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map((script) =>
		JSON.parse(script.textContent ?? ""),
	);
}

describe("/mcp SEO", () => {
	it("marks the connection guide indexable on its own canonical", async () => {
		const doc = await loadGuide();

		expect(doc.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe(
			"index, follow",
		);
		expect(doc.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(CANONICAL_URL);
		expect(doc.title).toBe("Connect Readplace to your AI assistant (MCP) — Readplace");
		expect(doc.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
			"Readplace runs an MCP server. Connect ChatGPT, Gemini, Claude, Perplexity, or any MCP client and your assistant can save pages to your reading queue and list back what you have saved.",
		);
	});

	it("emits one HowTo per client card between the WebPage and the breadcrumb", async () => {
		const doc = await loadGuide();
		const cards = Array.from(doc.querySelectorAll("[data-test-tool]"));
		expect(cards.length).toBeGreaterThan(0);

		const blocks = structuredData(doc);
		expect(blocks.map((block) => block["@type"])).toEqual([
			"WebPage",
			...cards.map(() => "HowTo"),
			"BreadcrumbList",
		]);

		const webPage = blocks[0];
		expect(webPage["@id"]).toBe(CANONICAL_URL);
		expect(webPage.url).toBe(CANONICAL_URL);
		expect(webPage.about["@id"]).toBe("https://readplace.com/#app");
	});

	it("keeps every HowTo identical to the steps the card shows", async () => {
		const doc = await loadGuide();
		const howTos = structuredData(doc).filter((block) => block["@type"] === "HowTo");

		const onPage = Array.from(doc.querySelectorAll("[data-test-tool]")).map((card) => {
			const heading = card.querySelector(".mcp-connect__tool-name");
			const requirement = card.querySelector(".mcp-connect__tool-req");
			assert(heading, "every client card must name the client");
			assert(requirement, "every client card must state what the client requires");
			return {
				name: `Connect Readplace to ${heading.textContent}`,
				description: requirement.textContent,
				steps: Array.from(card.querySelectorAll(".mcp-connect__step")).map(
					(step) => step.textContent,
				),
			};
		});

		expect(
			howTos.map((howTo) => ({
				name: howTo.name,
				description: howTo.description,
				steps: howTo.step.map((step: { text: string }) => step.text),
			})),
		).toEqual(onPage);
	});

	it("lists the connection guide in the sitemap so an assistant can find it by search", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const response = await request(harness.server).get("/sitemap.xml");

		const sitemap = new JSDOM(response.text, { contentType: "text/xml" }).window.document;
		const locations = Array.from(sitemap.querySelectorAll("loc")).map((loc) => loc.textContent);

		expect(locations).toContain(`${TEST_APP_ORIGIN}/mcp`);
	});
});
