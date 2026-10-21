import request from "supertest";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import type { PublishSaveLinkRawPdfCommand } from "@packages/provider-contracts/events";
import { UserIdSchema } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { useTestServer, type TestAppHarness } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { createAccessToken } from "../../test-helpers/oauth-token";

const TEST_USER_ID = UserIdSchema.parse("test-user-123");
const SHORT = "https://www.amazon.com.au/dp/1492043451?ref_=mr_direct_us_au_au&showmri";
const TITLE = "https://www.amazon.com.au/Fundamentals-Software-Architecture-Neal-Ford/dp/1492043451";
const SEARCH = "https://www.amazon.com.au/Fundamentals-Software-Architecture-Neal-Ford/dp/1492043451/ref=sr_1_5?qid=1&sr=8-5";
const BARE = "https://www.amazon.com.au/dp/1492043451";
const OTHER = "https://example.com/unrelated";
const VALID_HTML = Buffer.from("<html><body><p>Fundamentals of Software Architecture</p></body></html>");
const VALID_PDF = Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(64, 0x20)]);

const useApp = useTestServer();

function setup() {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const published: {
		rawHtml: string[];
		rawPdf: Parameters<PublishSaveLinkRawPdfCommand>[0][];
		attempts: string[];
	} = { rawHtml: [], rawPdf: [], attempts: [] };
	const testApp = useApp({
		...fixture,
		events: {
			...fixture.events,
			publishSaveLinkRawHtmlCommand: async (params) => {
				published.rawHtml.push(params.url);
				published.attempts.push(params.saveAttemptId);
			},
			publishSaveLinkRawPdfCommand: async (params) => {
				published.rawPdf.push(params);
				published.attempts.push(params.saveAttemptId);
			},
		},
	});
	return { testApp, fixture, published };
}

async function savedUrls(testApp: TestAppHarness): Promise<string[]> {
	const { articles } = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
	return articles.map((article) => article.url).sort();
}

async function queueOrder(testApp: TestAppHarness, token: string): Promise<string[]> {
	const response = await request(testApp.server)
		.get("/queue")
		.set("Accept", SIREN_MEDIA_TYPE)
		.set("Authorization", `Bearer ${token}`);
	return response.body.entities.map((entity: { properties: { url: string } }) => entity.properties.url);
}

async function seedLegacyTitleSave(testApp: TestAppHarness) {
	const { saved } = await testApp.articleStore.saveArticle({
		userId: TEST_USER_ID,
		url: TITLE,
		metadata: { title: "Saved before the product rule", siteName: "www.amazon.com.au", excerpt: "", wordCount: 0 },
		estimatedReadTime: MinutesSchema.parse(1),
		provenance: { kind: "web" },
		savedAt: new Date("2026-01-01T00:00:00.000Z"),
	});
	return saved;
}

async function seedAdoptedArticle(params: { fixture: ReturnType<typeof createDefaultTestAppFixture>; owner: string; landing: string }) {
	const { fixture, owner, landing } = params;
	await fixture.articleStore.saveArticleGlobally({ url: owner, metadata: { title: "T", siteName: "www.amazon.com.au", excerpt: "", wordCount: 0 }, estimatedReadTime: MinutesSchema.parse(1), savedAt: new Date() });
	await fixture.articleStore.setDisplayUrl({ url: owner, displayUrl: landing });
	await fixture.articleCrawl.markCrawlReady({ url: owner });
	await fixture.articleStore.claimAlias({ aliasUrl: landing, targetOriginalUrl: owner, now: new Date() });
}

function sirenSave(testApp: TestAppHarness, params: { token: string; url: string }) {
	return request(testApp.server)
		.post("/queue")
		.set("Accept", SIREN_MEDIA_TYPE)
		.set("Authorization", `Bearer ${params.token}`)
		.set("Content-Type", "application/json")
		.send({ url: params.url });
}

function saveContent(testApp: TestAppHarness, params: { token: string; fields: Record<string, string>; content?: Buffer }) {
	const pending = request(testApp.server)
		.post("/queue/save-content")
		.set("Accept", SIREN_MEDIA_TYPE)
		.set("Authorization", `Bearer ${params.token}`);
	for (const [name, value] of Object.entries(params.fields)) pending.field(name, value);
	return params.content ? pending.attach("content", params.content, "content") : pending;
}

describe("saving two spellings of one Amazon product keeps one card", () => {
	it("moves the card saved from the short link to the top when the title link is saved", async () => {
		const { testApp } = setup();
		const token = await createAccessToken(testApp);

		const first = await sirenSave(testApp, { token, url: SHORT });
		await sirenSave(testApp, { token, url: OTHER });
		const third = await sirenSave(testApp, { token, url: TITLE });

		expect(third.body.properties.id).toBe(first.body.properties.id);
		expect(await queueOrder(testApp, token)).toEqual([BARE, OTHER]);
	});

	it("attaches a title-link capture to the article saved under the short link", async () => {
		const { testApp, published } = setup();
		const token = await createAccessToken(testApp);

		const first = await sirenSave(testApp, { token, url: SHORT });
		const second = await saveContent(testApp, { token, fields: { url: TITLE, mediaType: "text/html" }, content: VALID_HTML });

		expect(second.body.properties.id).toBe(first.body.properties.id);
		expect(published.rawHtml).toEqual([BARE]);
		expect(testApp.pendingHtml.readPendingHtml(BARE, { saveAttemptId: published.attempts[0] })).toBe(VALID_HTML.toString("utf8"));
		expect(await savedUrls(testApp)).toEqual([BARE]);
	});

	it(".com and .com.au title links of one product are saved as their two bare links", async () => {
		const { testApp } = setup();
		const token = await createAccessToken(testApp);

		await sirenSave(testApp, { token, url: "https://www.amazon.com/Fundamentals-Software-Architecture-Neal-Ford/dp/1492043451" });
		await sirenSave(testApp, { token, url: TITLE });

		expect(await savedUrls(testApp)).toEqual(["https://www.amazon.com.au/dp/1492043451", "https://www.amazon.com/dp/1492043451"]);
	});

	it("saves a search-result link exactly as submitted, as its own article", async () => {
		const { testApp } = setup();
		const token = await createAccessToken(testApp);

		const response = await sirenSave(testApp, { token, url: SEARCH });

		expect(response.body.properties.url).toBe(SEARCH);
		expect(await savedUrls(testApp)).toEqual([SEARCH]);
	});
});

describe("upload slots and completions for Amazon title-link captures", () => {
	const attempt = "a5d68419-dc83-4f6c-84a9-67e6808acb57";

	it("issues the upload slot for a title-link capture at the bare link", async () => {
		const { testApp } = setup();
		const token = await createAccessToken(testApp);

		const response = await saveContent(testApp, { token, fields: { url: TITLE, mediaType: "application/pdf", title: "Big", size: String(50 * 1024 * 1024) } });

		expect(response.status).toBe(200);
		const complete = response.body.actions.find((action: { name: string }) => action.name === "save-uploaded-content");
		const fields = Object.fromEntries(complete.fields.map((field: { name: string; value?: string }) => [field.name, field.value]));
		expect(fields).toEqual({ url: BARE, mediaType: "application/pdf", title: "Big", uploaded: "true", saveAttemptId: expect.any(String) });
		const upload = response.body.actions.find((action: { name: string }) => action.name === "upload-content");
		expect(upload.href).toBe(`${TEST_APP_ORIGIN}/e2e/s3/${encodeURIComponent(ArticleResourceUniqueId.parse(BARE).toS3PendingPdfKey(fields.saveAttemptId))}`);
	});

	it("completes an upload under the title link from the object staged under the bare link", async () => {
		const { testApp, published } = setup();
		const token = await createAccessToken(testApp);
		testApp.pendingUpload.stageUploaded({ url: BARE, saveAttemptId: attempt, mediaType: "application/pdf", bytes: VALID_PDF });

		const response = await saveContent(testApp, { token, fields: { url: TITLE, mediaType: "application/pdf", uploaded: "true", saveAttemptId: attempt } });

		expect(response.status).toBe(201);
		expect(published.rawPdf).toEqual([expect.objectContaining({ url: BARE, sourceUrl: TITLE })]);
		expect(await savedUrls(testApp)).toEqual([BARE]);
	});
});

describe("bulk saves of Amazon product links", () => {
	it("stages a title-link capture under the bare key and answers under the submitted URL", async () => {
		const { testApp, published } = setup();
		const token = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.field("manifest", JSON.stringify([{ url: TITLE, title: "Book", mediaType: "text/html" }]))
			.attach("content-0", VALID_HTML, "content-0");

		expect(response.status).toBe(200);
		expect(response.body.properties.results.map((result: { url: string }) => result.url)).toEqual([TITLE]);
		expect(published.rawHtml).toEqual([BARE]);
		expect(testApp.pendingHtml.readPendingHtml(BARE, { saveAttemptId: published.attempts[0] })).toBe(VALID_HTML.toString("utf8"));
		expect(testApp.pendingHtml.readPendingHtml(TITLE, { saveAttemptId: published.attempts[0] })).toBeUndefined();
		expect(await savedUrls(testApp)).toEqual([BARE]);
	});

	it("makes one article and one card from two spellings in one request", async () => {
		const { testApp } = setup();
		const token = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.field("manifest", JSON.stringify([{ url: SHORT }, { url: TITLE }]));

		expect(response.status).toBe(200);
		expect(response.body.properties.results.map((result: { outcome: string }) => result.outcome).sort()).toEqual(["created", "merged"]);
		expect(await queueOrder(testApp, token)).toEqual([BARE]);
	});
});

describe("the extension's saved-tab check for an Amazon product", () => {
	it("finds the bare article for a title-link tab", async () => {
		const { testApp } = setup();
		const token = await createAccessToken(testApp);
		await sirenSave(testApp, { token, url: SHORT });

		const response = await request(testApp.server)
			.get(`/queue?url=${encodeURIComponent(TITLE)}`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`);

		expect(response.status).toBe(200);
		expect(response.body.entities.map((entity: { properties: { url: string } }) => entity.properties.url)).toEqual([BARE]);
	});

	it("shows the legacy title-link article for a title-link tab when both exist", async () => {
		const { testApp } = setup();
		const token = await createAccessToken(testApp);
		await seedLegacyTitleSave(testApp);
		await sirenSave(testApp, { token, url: BARE });

		const response = await request(testApp.server)
			.get(`/queue?url=${encodeURIComponent(TITLE)}`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`);

		expect(response.body.entities.map((entity: { properties: { url: string } }) => entity.properties.url)).toEqual([TITLE]);
	});
});

describe("Amazon product articles stored before the rule", () => {
	it("leaves a legacy title-link article in place and saves the product again as a separate bare article", async () => {
		const { testApp } = setup();
		const token = await createAccessToken(testApp);
		await seedLegacyTitleSave(testApp);

		const response = await sirenSave(testApp, { token, url: TITLE });

		expect(response.body.properties.id).toBe(ReaderArticleHashId.from(BARE).value);
		expect(await savedUrls(testApp)).toEqual([TITLE, BARE]);
	});

	it.each([SHORT, TITLE, BARE])("lands a save of %s on an article adopted under the bare link", async (url) => {
		const { testApp, fixture } = setup();
		const token = await createAccessToken(testApp);
		const owner = "https://tracker.example/c/7f3a";
		await seedAdoptedArticle({ fixture, owner, landing: BARE });

		const response = await sirenSave(testApp, { token, url });

		expect(response.body.properties.id).toBe(ReaderArticleHashId.from(owner).value);
		expect(await savedUrls(testApp)).toEqual([owner]);
	});

	it("saves a product as a separate bare article when its adopted article sits at a non-bare link", async () => {
		const { testApp, fixture } = setup();
		const token = await createAccessToken(testApp);
		const owner = "https://tracker.example/c/7f3a";
		await seedAdoptedArticle({ fixture, owner, landing: SHORT });

		const response = await sirenSave(testApp, { token, url: SHORT });

		expect(response.body.properties.id).toBe(ReaderArticleHashId.from(BARE).value);
		expect(await savedUrls(testApp)).toEqual([BARE]);
	});
});
