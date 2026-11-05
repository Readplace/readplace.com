import assert from "node:assert/strict";
import request from "supertest";
import { ReaderArticleHashId } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { MAX_POLLS } from "@packages/web-shell";
import { z } from "zod";
import { loginAgent, useTestServer } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { createAccessToken } from "../../test-helpers/oauth-token";

const useApp = useTestServer();

const fixedNow = new Date("2026-11-05T10:03:20.000Z");
const PENDING: ArticleCrawl = {
	status: "pending",
	startedAt: new Date(fixedNow.getTime() - 40_000).toISOString(),
	stage: "crawl-fetching",
};

const Article = z.looseObject({
	class: z.array(z.string()),
	properties: z.looseObject({
		id: z.string(),
		processing: z.object({ refresh: z.object({ href: z.string(), afterSeconds: z.number() }) }).optional(),
		messages: z.array(z.object({ type: z.string(), content: z.object({ body: z.string() }) })).optional(),
	}),
	actions: z.array(z.object({ name: z.string(), href: z.string() })),
});

function appWithCrawl(crawl: ArticleCrawl | undefined) {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	return useApp({
		...fixture,
		articleCrawl: { ...fixture.articleCrawl, findArticleCrawlStatus: async () => crawl },
		shared: { ...fixture.shared, now: () => fixedNow },
	});
}

const USER_ID = UserIdSchema.parse("test-user-123");
const SAVED_URL = "https://example.com/polled";
const SAVED_ID = ReaderArticleHashId.from(SAVED_URL).value;

async function readerWithSavedItem(crawl: ArticleCrawl | undefined) {
	const harness = appWithCrawl(crawl);
	const token = await createAccessToken(harness);
	const saved = await request(harness.server)
		.post("/queue")
		.set("Authorization", `Bearer ${token}`)
		.set("Accept", SIREN_MEDIA_TYPE)
		.type("json")
		.send({ url: SAVED_URL });
	expect(saved.status).toBe(201);
	const pollCard = (query: string) =>
		request(harness.server)
			.get(`/queue/${SAVED_ID}/card${query}`)
			.set("Authorization", `Bearer ${token}`)
			.set("Accept", SIREN_MEDIA_TYPE);
	return { harness, pollCard };
}

describe("GET /queue/:id/card over Siren", () => {
	it("answers the item as a top-level article entity with the next poll, and revalidating headers", async () => {
		const { pollCard } = await readerWithSavedItem(PENDING);

		const response = await pollCard("?poll=5");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain(SIREN_MEDIA_TYPE);
		expect(response.body).not.toHaveProperty("rel");
		const entity = Article.parse(response.body);
		expect(entity.class).toEqual(["article"]);
		expect(entity.properties.processing?.refresh).toEqual({
			href: `/queue/${SAVED_ID}/card?status=unread&poll=6`,
			afterSeconds: 3,
		});
		expect(response.headers["cache-control"]).toBe("private, no-cache");
		expect(response.headers.vary).toContain("Accept");
		expect(response.headers.vary).toContain("Authorization");
	});

	it("keeps the addressed readlist, status and order in the refresh and in the item's actions", async () => {
		const { harness, pollCard } = await readerWithSavedItem(PENDING);
		const work = ReadlistSlugSchema.parse("work");
		await harness.articleStore.createReadlistDefinition({ userId: USER_ID, slug: work, label: "Work", createdAt: new Date() });

		const response = await pollCard(`?readlist=${work}&status=read&order=asc&poll=1`);

		const entity = Article.parse(response.body);
		const query = `readlist=${work}&status=read&order=asc`;
		expect(entity.properties.processing?.refresh.href).toBe(`/queue/${SAVED_ID}/card?${query}&poll=2`);
		expect(entity.actions.find((action) => action.name === "update-status")?.href).toBe(
			`/queue/${SAVED_ID}/status?${query}`,
		);
	});

	it("carries a warning and no processing past the poll budget", async () => {
		const { pollCard } = await readerWithSavedItem(PENDING);

		const response = await pollCard(`?poll=${MAX_POLLS}`);

		const { properties } = Article.parse(response.body);
		expect(properties.processing).toBeUndefined();
		expect(properties.messages?.map((message) => message.type)).toEqual(["warning"]);
		expect(properties.messages?.[0]?.content.body).toContain("Taking a while");
	});

	it("carries no processing once the work settled", async () => {
		const { pollCard } = await readerWithSavedItem({ status: "failed", outcomeRevision: 1, reason: "boom" });

		const response = await pollCard("?poll=1");

		expect(Article.parse(response.body).properties.processing).toBeUndefined();
	});

	it("refuses an unknown id with the unknown-article refusal", async () => {
		const harness = appWithCrawl(PENDING);
		const token = await createAccessToken(harness);

		const response = await request(harness.server)
			.get("/queue/0123456789abcdef0123456789abcdef/card")
			.set("Authorization", `Bearer ${token}`)
			.set("Accept", SIREN_MEDIA_TYPE);

		expect(response.status).toBe(404);
		expect(response.headers["content-type"]).toContain(SIREN_MEDIA_TYPE);
		expect(JSON.stringify(response.body)).toContain("unknown-article");
	});

	it("leaves the HTML card's ETag and 304 as they were", async () => {
		const harness = appWithCrawl(PENDING);
		const agent = await loginAgent(harness.server, harness.auth);
		await agent.post("/queue/save").type("form").send({ url: SAVED_URL });

		const first = await agent.get(`/queue/${SAVED_ID}/card?poll=1`);
		const { etag } = first.headers;
		assert(etag, "the HTML card must carry an ETag");
		const second = await agent.get(`/queue/${SAVED_ID}/card?poll=1`).set("If-None-Match", etag);

		expect(second.status).toBe(304);
	});
});
