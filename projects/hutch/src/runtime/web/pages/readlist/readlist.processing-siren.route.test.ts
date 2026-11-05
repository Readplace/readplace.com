import assert from "node:assert/strict";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import request from "supertest";
import { z } from "zod";
import { type TestAppHarness, useTestServer } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { createAccessToken } from "../../test-helpers/oauth-token";

const useApp = useTestServer();

const fixedNow = new Date("2026-11-05T10:03:20.000Z");

const Collection = z.object({
	entities: z.array(z.object({ properties: z.object({ url: z.string(), processing: z.unknown() }) })),
});

const Saved = z.object({ properties: z.object({ id: z.string(), processing: z.unknown() }) });

function appWithCrawl(crawlFor: (url: string) => ArticleCrawl | undefined) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	return useApp({
		...fixture,
		articleCrawl: { ...fixture.articleCrawl, findArticleCrawlStatus: async (url: string) => crawlFor(url) },
		shared: { ...fixture.shared, now: () => fixedNow },
	});
}

function save(params: { harness: TestAppHarness; token: string; url: string }) {
	return request(params.harness.server)
		.post("/queue")
		.set("Authorization", `Bearer ${params.token}`)
		.set("Accept", SIREN_MEDIA_TYPE)
		.type("json")
		.send({ url: params.url });
}

describe("Article processing over Siren", () => {
	it("lists a pending item with the web card's label and estimate, and a refresh on its first poll", async () => {
		const harness = appWithCrawl(() => ({
			status: "pending",
			startedAt: new Date(fixedNow.getTime() - 40_000).toISOString(),
			stage: "crawl-fetching",
		}));
		const token = await createAccessToken(harness);
		const saved = await save({ harness, token, url: "https://example.com/pending" });
		expect(saved.status).toBe(201);

		const response = await request(harness.server)
			.get("/queue")
			.set("Authorization", `Bearer ${token}`)
			.set("Accept", SIREN_MEDIA_TYPE);

		const [row] = Collection.parse(response.body).entities;
		assert(row, "the saved item must be listed");
		expect(row.properties.processing).toMatchObject({
			label: "Processing",
			estimate: { kind: "counting", seconds: 120 },
			refresh: { afterSeconds: 3 },
		});
		expect(z.object({ refresh: z.object({ href: z.string() }) }).parse(row.properties.processing).refresh.href).toMatch(
			/^\/queue\/[^/]+\/card\?.*poll=1$/,
		);
	});

	it("answers a save with the item processing and no estimate, since no crawl row is read yet", async () => {
		const harness = appWithCrawl(() => undefined);
		const token = await createAccessToken(harness);

		const response = await save({ harness, token, url: "https://example.com/just-saved" });

		expect(response.status).toBe(201);
		const { id, processing } = Saved.parse(response.body).properties;
		expect(processing).toEqual({ label: "Processing", refresh: { href: `/queue/${id}/card?poll=1`, afterSeconds: 3 } });
	});
});
