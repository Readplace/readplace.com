import assert from "node:assert/strict";
import request from "supertest";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { MinutesSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { loginAgent, useTestServer, type TestAppHarness } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { createAccessToken } from "../../test-helpers/oauth-token";

const TEST_USER_ID = UserIdSchema.parse("test-user-123");
const TWEET_ON_TWITTER = "https://twitter.com/jack/status/20";
const TWEET_ON_X = "https://x.com/jack/status/20";
const VALID_HTML = Buffer.from("<html><body><p>just setting up my twttr</p></body></html>");
const VALID_PDF = Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(64, 0x20)]);

const useApp = useTestServer();

function setup() {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const published = {
		linkSaved: [] as string[],
		linkQueued: [] as string[],
		rawHtml: [] as string[],
		rawPdf: [] as string[],
	};
	const testApp = useApp({
		...fixture,
		events: {
			...fixture.events,
			publishLinkSaved: async (params) => {
				published.linkSaved.push(params.url);
				await fixture.events.publishLinkSaved(params);
			},
			publishLinkQueued: async (params) => {
				published.linkQueued.push(params.url);
			},
			publishSaveLinkRawHtmlCommand: async (params) => {
				published.rawHtml.push(params.url);
			},
			publishSaveLinkRawPdfCommand: async (params) => {
				published.rawPdf.push(params.url);
			},
		},
	});
	return { testApp, published };
}

async function savedUrls(testApp: TestAppHarness): Promise<string[]> {
	const { articles } = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
	return articles.map((article) => article.url).sort();
}

async function seedLegacyTwitterSave(testApp: TestAppHarness) {
	const { saved } = await testApp.articleStore.saveArticle({
		userId: TEST_USER_ID,
		url: TWEET_ON_TWITTER,
		metadata: { title: "Saved before x.com", siteName: "twitter.com", excerpt: "", wordCount: 0 },
		estimatedReadTime: MinutesSchema.parse(1),
		provenance: { kind: "web" },
		savedAt: new Date("2026-01-01T00:00:00.000Z"),
	});
	return saved;
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

describe("saving a twitter.com link stores it as the x.com article", () => {
	it("stores the extension's single save of a twitter.com tab under x.com and announces it there", async () => {
		const { testApp, published } = setup();
		const token = await createAccessToken(testApp);

		const response = await sirenSave(testApp, { token, url: TWEET_ON_TWITTER });

		expect(response.status).toBe(201);
		expect(response.body.properties.url).toBe(TWEET_ON_X);
		expect(await savedUrls(testApp)).toEqual([TWEET_ON_X]);
		expect(published.linkSaved).toEqual([TWEET_ON_X]);
		expect(published.linkQueued).toEqual([TWEET_ON_X]);
	});

	it("stores a twitter.com link typed into the readlist save bar under x.com", async () => {
		const { testApp } = setup();
		const agent = await loginAgent(testApp.server, testApp.auth);

		const response = await agent.post("/queue/save").type("form").send({ url: TWEET_ON_TWITTER });

		expect(response.status).toBe(303);
		const { userId } = await testApp.auth.findUserByEmail("test@example.com").then((user) => {
			assert(user, "the logged-in user exists");
			return user;
		});
		const { articles } = await testApp.articleStore.findArticlesByUser({ userId });
		expect(articles.map((article) => article.url)).toEqual([TWEET_ON_X]);
	});

	it("stages a bulk save's twitter.com capture under the x.com key and answers under the submitted URL", async () => {
		const { testApp, published } = setup();
		const token = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.field("manifest", JSON.stringify([
				{ url: TWEET_ON_TWITTER, title: "Tweet", mediaType: "text/html" },
				{ url: "https://twitter.com/jack/status/21" },
			]))
			.attach("content-0", VALID_HTML, "content-0");

		expect(response.status).toBe(200);
		expect(response.body.properties).toEqual(expect.objectContaining({ saved: 2, skipped: 0, failed: 0 }));
		expect(published.rawHtml).toEqual([TWEET_ON_X]);
		expect(testApp.pendingHtml.readPendingHtml(TWEET_ON_X)).toBe(VALID_HTML.toString("utf8"));
		expect(testApp.pendingHtml.readPendingHtml(TWEET_ON_TWITTER)).toBeUndefined();
		expect(await savedUrls(testApp)).toEqual([TWEET_ON_X, "https://x.com/jack/status/21"]);
	});

	it("stages an inline twitter.com HTML capture under the x.com key", async () => {
		const { testApp, published } = setup();
		const token = await createAccessToken(testApp);

		const response = await saveContent(testApp, {
			token,
			fields: { url: TWEET_ON_TWITTER, mediaType: "text/html", title: "Tweet" },
			content: VALID_HTML,
		});

		expect(response.status).toBe(201);
		expect(response.body.properties.url).toBe(TWEET_ON_X);
		expect(published.rawHtml).toEqual([TWEET_ON_X]);
		expect(testApp.pendingHtml.readPendingHtml(TWEET_ON_X)).toBe(VALID_HTML.toString("utf8"));
		expect(await savedUrls(testApp)).toEqual([TWEET_ON_X]);
	});

	it("stages an inline twitter.com PDF capture under the x.com key", async () => {
		const { testApp, published } = setup();
		const token = await createAccessToken(testApp);

		const response = await saveContent(testApp, {
			token,
			fields: { url: TWEET_ON_TWITTER, mediaType: "application/pdf" },
			content: VALID_PDF,
		});

		expect(response.status).toBe(201);
		expect(published.rawPdf).toEqual([TWEET_ON_X]);
		expect(testApp.pendingPdf.readPendingPdfSync(TWEET_ON_X)).toEqual(VALID_PDF);
	});
});

describe("upload slots and completions for twitter.com captures", () => {
	it("issues a new slot at the x.com key whose completion action names x.com", async () => {
		const { testApp } = setup();
		const token = await createAccessToken(testApp);

		const response = await saveContent(testApp, {
			token,
			fields: { url: TWEET_ON_TWITTER, mediaType: "application/pdf", title: "Big", size: String(50 * 1024 * 1024) },
		});

		expect(response.status).toBe(200);
		const upload = response.body.actions.find((action: { name: string }) => action.name === "upload-content");
		expect(upload.href).toBe(
			`${TEST_APP_ORIGIN}/e2e/s3/${encodeURIComponent(ArticleResourceUniqueId.parse(TWEET_ON_X).toS3PendingPdfKey())}`,
		);
		const complete = response.body.actions.find((action: { name: string }) => action.name === "save-uploaded-content");
		const fields = Object.fromEntries(complete.fields.map((field: { name: string; value?: string }) => [field.name, field.value]));
		expect(fields).toEqual({ url: TWEET_ON_X, mediaType: "application/pdf", title: "Big", uploaded: "true" });
	});

	it("finishes a slot issued before deployment under the twitter.com identity its object was uploaded to", async () => {
		const { testApp, published } = setup();
		const token = await createAccessToken(testApp);
		testApp.pendingUpload.stageUploaded({ url: TWEET_ON_TWITTER, mediaType: "text/html", bytes: VALID_HTML });

		const response = await saveContent(testApp, {
			token,
			fields: { url: TWEET_ON_TWITTER, mediaType: "text/html", uploaded: "true" },
		});

		expect(response.status).toBe(201);
		expect(published.rawHtml).toEqual([TWEET_ON_TWITTER]);
		expect(await savedUrls(testApp)).toEqual([TWEET_ON_TWITTER]);
	});

	it("finishes under x.com when only the x.com object was uploaded for a twitter.com completion", async () => {
		const { testApp, published } = setup();
		const token = await createAccessToken(testApp);
		testApp.pendingUpload.stageUploaded({ url: TWEET_ON_X, mediaType: "application/pdf", bytes: VALID_PDF });

		const response = await saveContent(testApp, {
			token,
			fields: { url: TWEET_ON_TWITTER, mediaType: "application/pdf", uploaded: "true" },
		});

		expect(response.status).toBe(201);
		expect(published.rawPdf).toEqual([TWEET_ON_X]);
		expect(await savedUrls(testApp)).toEqual([TWEET_ON_X]);
	});

	it("prefers the submitted twitter.com object when both spellings were uploaded", async () => {
		const { testApp, published } = setup();
		const token = await createAccessToken(testApp);
		testApp.pendingUpload.stageUploaded({ url: TWEET_ON_TWITTER, mediaType: "text/html", bytes: VALID_HTML });
		testApp.pendingUpload.stageUploaded({ url: TWEET_ON_X, mediaType: "text/html", bytes: VALID_HTML });

		await saveContent(testApp, { token, fields: { url: TWEET_ON_TWITTER, mediaType: "text/html", uploaded: "true" } });

		expect(published.rawHtml).toEqual([TWEET_ON_TWITTER]);
	});

	it("refuses an expired twitter.com object instead of passing over it to a fresh x.com one", async () => {
		const { testApp, published } = setup();
		const token = await createAccessToken(testApp);
		testApp.pendingUpload.stageUploaded({
			url: TWEET_ON_TWITTER,
			mediaType: "text/html",
			bytes: VALID_HTML,
			stagedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
		});
		testApp.pendingUpload.stageUploaded({ url: TWEET_ON_X, mediaType: "text/html", bytes: VALID_HTML });

		const response = await saveContent(testApp, {
			token,
			fields: { url: TWEET_ON_TWITTER, mediaType: "text/html", uploaded: "true" },
		});

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("upload-not-found");
		expect(published.rawHtml).toEqual([]);
	});

	it("checks the media of the object it selected", async () => {
		const { testApp, published } = setup();
		const token = await createAccessToken(testApp);
		testApp.pendingUpload.stageUploaded({ url: TWEET_ON_X, mediaType: "application/pdf", bytes: Buffer.from("not a pdf") });

		const response = await saveContent(testApp, {
			token,
			fields: { url: TWEET_ON_TWITTER, mediaType: "application/pdf", uploaded: "true" },
		});

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("not-a-pdf");
		expect(published.rawPdf).toEqual([]);
	});

	it("does not look for a twitter.com object when the completion names x.com", async () => {
		const { testApp } = setup();
		const token = await createAccessToken(testApp);
		testApp.pendingUpload.stageUploaded({ url: TWEET_ON_TWITTER, mediaType: "text/html", bytes: VALID_HTML });

		const response = await saveContent(testApp, {
			token,
			fields: { url: TWEET_ON_X, mediaType: "text/html", uploaded: "true" },
		});

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("upload-not-found");
	});
});

describe("twitter.com and x.com saves of one tweet land on one article", () => {
	it("attaches an x.com capture to the article a failed twitter.com save created", async () => {
		const { testApp, published } = setup();
		const token = await createAccessToken(testApp);

		const first = await sirenSave(testApp, { token, url: TWEET_ON_TWITTER });
		const second = await saveContent(testApp, { token, fields: { url: TWEET_ON_X, mediaType: "text/html" }, content: VALID_HTML });

		expect(second.body.properties.id).toBe(first.body.properties.id);
		expect(await savedUrls(testApp)).toEqual([TWEET_ON_X]);
		expect(published.rawHtml).toEqual([TWEET_ON_X]);
	});

	it("keeps one article when the x.com capture arrives before the twitter.com link", async () => {
		const { testApp } = setup();
		const token = await createAccessToken(testApp);

		const first = await saveContent(testApp, { token, fields: { url: TWEET_ON_X, mediaType: "text/html" }, content: VALID_HTML });
		const second = await sirenSave(testApp, { token, url: TWEET_ON_TWITTER });

		expect(second.body.properties.id).toBe(first.body.properties.id);
		expect(await savedUrls(testApp)).toEqual([TWEET_ON_X]);
	});

	it("keeps one article when both spellings are saved at once", async () => {
		const { testApp } = setup();
		const token = await createAccessToken(testApp);

		const responses = await Promise.all([
			sirenSave(testApp, { token, url: TWEET_ON_TWITTER }),
			saveContent(testApp, { token, fields: { url: TWEET_ON_TWITTER, mediaType: "text/html" }, content: VALID_HTML }),
			sirenSave(testApp, { token, url: TWEET_ON_X }),
		]);

		expect(new Set(responses.map((response) => response.body.properties.id)).size).toBe(1);
		expect(await savedUrls(testApp)).toEqual([TWEET_ON_X]);
	});
});

describe("a legacy twitter.com save alongside new x.com saves", () => {
	it("saves the tweet again as a separate x.com article, leaving the twitter.com one in place", async () => {
		const { testApp } = setup();
		const token = await createAccessToken(testApp);
		const legacy = await seedLegacyTwitterSave(testApp);

		const response = await sirenSave(testApp, { token, url: TWEET_ON_TWITTER });

		expect(response.body.properties.id).not.toBe(legacy.id.value);
		expect(await savedUrls(testApp)).toEqual([TWEET_ON_TWITTER, TWEET_ON_X]);
	});

	it("deletes each of the two articles on its own", async () => {
		const { testApp } = setup();
		const token = await createAccessToken(testApp);
		const legacy = await seedLegacyTwitterSave(testApp);
		await sirenSave(testApp, { token, url: TWEET_ON_TWITTER });

		const deleted = await request(testApp.server)
			.post(`/queue/${legacy.id.value}/delete`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.redirects(0);

		expect(deleted.status).toBe(303);
		expect(await savedUrls(testApp)).toEqual([TWEET_ON_X]);
	});

	it("tells the extension a twitter.com tab is saved when only its x.com article exists", async () => {
		const { testApp } = setup();
		const token = await createAccessToken(testApp);
		await sirenSave(testApp, { token, url: TWEET_ON_TWITTER });

		const response = await request(testApp.server)
			.get(`/queue?url=${encodeURIComponent(TWEET_ON_TWITTER)}`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`);

		expect(response.status).toBe(200);
		expect(response.body.entities.map((entity: { properties: { url: string } }) => entity.properties.url)).toEqual([TWEET_ON_X]);
	});

	it("shows the extension the legacy twitter.com article for a twitter.com tab when both exist", async () => {
		const { testApp } = setup();
		const token = await createAccessToken(testApp);
		await seedLegacyTwitterSave(testApp);
		await sirenSave(testApp, { token, url: TWEET_ON_X });

		const response = await request(testApp.server)
			.get(`/queue?url=${encodeURIComponent(TWEET_ON_TWITTER)}`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`);

		expect(response.body.entities.map((entity: { properties: { url: string } }) => entity.properties.url)).toEqual([TWEET_ON_TWITTER]);
	});
});
