import assert from "node:assert/strict";
import request from "supertest";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { saveAccessTokenForClient } from "../../test-helpers/oauth-token";

const useApp = useTestServer();

type Harness = ReturnType<typeof useApp>;

const ARTICLE_URL = "https://example.com/read-only";

async function readOnlyBearer(harness: Harness): Promise<string> {
	await loginAgent(harness.server, harness.auth);
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the logged-in user must exist");
	const { userId } = user;
	await harness.articleStore.saveArticle({
		userId,
		url: ARTICLE_URL,
		metadata: { title: "Kept article", siteName: "example.com", excerpt: "Kept.", wordCount: 2 },
		estimatedReadTime: MinutesSchema.parse(1),
		provenance: { kind: "web" },
		savedAt: new Date("2026-09-30T01:02:03.000Z"),
		saveTrigger: "manual",
	});
	await harness.articleStore.writeContent({ url: ARTICLE_URL, content: "<p>Body copy.</p>" });
	await harness.articleCrawl.markCrawlReady({ url: ARTICLE_URL });
	await harness.subscriptionProviders.upsertActive({
		userId,
		subscriptionId: "sub_lapsed",
		customerId: "cus_lapsed",
	});
	await harness.subscriptionProviders.markCancelledByUserId({ userId });
	return saveAccessTokenForClient(harness, { userId, clientId: "obsidian-plugin" });
}

function sirenGet(harness: Harness, params: { path: string; token: string }) {
	return request(harness.server)
		.get(params.path)
		.set("Accept", SIREN_MEDIA_TYPE)
		.set("Authorization", `Bearer ${params.token}`);
}

describe("Read-only account with an obsidian-plugin bearer", () => {
	it("sends the entry point to the listing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await readOnlyBearer(harness);

		const response = await sirenGet(harness, { path: "/", token }).redirects(0);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
	});

	it("lists the saved article as Siren with a stable contentVersion", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await readOnlyBearer(harness);

		const first = await sirenGet(harness, { path: "/queue", token });
		const second = await sirenGet(harness, { path: "/queue", token });

		expect(first.status).toBe(200);
		expect(first.headers["content-type"]).toMatch(/^application\/vnd\.siren\+json/);
		expect(first.body.entities).toHaveLength(1);
		const [article] = first.body.entities;
		expect(article.class).toContain("article");
		expect(article.properties.contentVersion).toMatch(/^[0-9a-f]{16}$/);
		expect(second.body.entities[0].properties.contentVersion).toBe(article.properties.contentVersion);
		expect(first.body.properties.readlists).toContainEqual(expect.objectContaining({ rel: "current" }));
		expect(first.body.properties.tabs).toContainEqual(expect.objectContaining({ rel: "current" }));
	});

	it("serves the article's read link as Markdown", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await readOnlyBearer(harness);
		const listing = await sirenGet(harness, { path: "/queue", token });
		const read = listing.body.entities[0].links.find((link: { rel: string[] }) => link.rel.includes("read"));
		assert(read, "the article entity must carry a read link");

		const response = await request(harness.server)
			.get(read.href)
			.set("Accept", "text/markdown")
			.set("Authorization", `Bearer ${token}`);

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/^text\/markdown/);
		expect(response.text.startsWith("---\n")).toBe(true);
		expect(response.text).toContain(`readplace_id: ${ReaderArticleHashId.from(ARTICLE_URL).value}`);
	});

	it("refuses a save with 402, which is what makes the account read-only", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const token = await readOnlyBearer(harness);
		const listing = await sirenGet(harness, { path: "/queue", token });
		const save = listing.body.actions.find((action: { name: string }) => action.name === "save-article");
		assert(save, "the listing must advertise the save-article action");

		const response = await request(harness.server)
			.post(save.href)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.type("json")
			.send({ url: "https://example.com/refused" });

		expect(response.status).toBe(402);
		expect(response.headers["content-type"]).toMatch(/^application\/vnd\.siren\+json/);
	});
});
