import { JSDOM } from "jsdom";
import request from "supertest";
import { calculateReadTime } from "@packages/domain/article";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer } from "../../../test-app";

const TITLE = "https://www.amazon.com.au/Fundamentals-Software-Architecture-Neal-Ford/dp/1492043451";
const TITLE_VIEW_PATH = "/view/www.amazon.com.au/Fundamentals-Software-Architecture-Neal-Ford/dp/1492043451";
const BARE = "https://www.amazon.com.au/dp/1492043451";

const useApp = useTestServer();

async function harnessWith(rows: { url: string; title: string }[]) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	for (const row of rows) {
		await fixture.articleStore.saveArticleGlobally({
			url: row.url,
			metadata: { title: row.title, siteName: new URL(row.url).hostname, excerpt: "", wordCount: 0 },
			estimatedReadTime: calculateReadTime(0),
			savedAt: new Date("2026-01-01T00:00:00.000Z"),
		});
	}
	const stubbed: string[] = [];
	const anonymousSaves: string[] = [];
	const staleChecks: string[] = [];
	const harness = useApp({
		...fixture,
		articleStore: {
			...fixture.articleStore,
			saveArticleGlobally: async (params) => {
				stubbed.push(params.url);
				return fixture.articleStore.saveArticleGlobally(params);
			},
		},
		events: {
			...fixture.events,
			publishSaveAnonymousLink: async (params) => {
				anonymousSaves.push(params.url);
			},
			publishStaleCheckRequested: async (params) => {
				staleChecks.push(params.url);
			},
		},
	});
	return { harness, fixture, stubbed, anonymousSaves, staleChecks };
}

function titleOf(html: string): string | null | undefined {
	return new JSDOM(html).window.document.querySelector("[data-test-reader-title]")?.textContent;
}

describe("/view of an Amazon product saved under its title link, its bare link, or neither", () => {
	it("serves the bare article for a title link nobody saved", async () => {
		const { harness, stubbed, staleChecks } = await harnessWith([{ url: BARE, title: "Bare product" }]);

		const response = await request(harness.server).get(TITLE_VIEW_PATH);

		expect(response.status).toBe(200);
		expect(titleOf(response.text)).toBe("Bare product");
		expect(stubbed).toEqual([]);
		expect(staleChecks).toEqual([BARE]);
	});

	it("creates the article under the bare link on a first visit to a title link", async () => {
		const { harness, fixture, stubbed, anonymousSaves } = await harnessWith([]);

		const response = await request(harness.server).get(TITLE_VIEW_PATH);

		expect(response.status).toBe(200);
		expect(stubbed).toEqual([BARE]);
		expect(anonymousSaves).toEqual([BARE]);
		expect(await fixture.articleStore.findArticleByUrl(TITLE)).toBeNull();
	});

	it("serves a legacy title-link article from its own record", async () => {
		const { harness, stubbed, staleChecks } = await harnessWith([
			{ url: TITLE, title: "Legacy product" },
			{ url: BARE, title: "Bare product" },
		]);

		const response = await request(harness.server).get(TITLE_VIEW_PATH);

		expect(response.status).toBe(200);
		expect(titleOf(response.text)).toBe("Legacy product");
		expect(stubbed).toEqual([]);
		expect(staleChecks).toEqual([TITLE]);
	});
});
