import assert from "node:assert";
import request from "supertest";
import type { Token, Client } from "@node-oauth/oauth2-server";
import type {
	PublishSaveLinkRawHtmlCommand,
	PublishSaveLinkRawPdfCommand,
} from "@packages/test-fixtures/providers/events";
import type { UserId } from "@packages/domain/user";
import { useTestServer, loginAgent, type TestAppHarness, type TestAppResult } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { MAX_PAGES_PER_BULK_SAVE, MAX_UPLOAD_CONTENT_BYTES, MAX_BULK_PAGE_CONTENT_BYTES, MAX_UPLOAD_REQUEST_BYTES } from "@packages/domain/article";

const TEST_USER_ID = "test-user-bulk" as UserId;

function createTestToken(): Token {
	return {
		accessToken: "test-access-token-bulk",
		accessTokenExpiresAt: new Date(Date.now() + 3600000),
		refreshToken: "test-refresh-token-bulk",
		refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
		client: {
			id: "hutch-firefox-extension",
			grants: ["authorization_code", "refresh_token"],
			redirectUris: ["http://127.0.0.1:3000/oauth/callback"],
		} as Client,
		user: { id: TEST_USER_ID },
	};
}

async function createAccessToken(testApp: TestAppResult): Promise<string> {
	const client = await testApp.oauthModel.getClient("hutch-firefox-extension", "");
	assert(client, "Test client must exist");
	const testToken = createTestToken();
	const token = await testApp.oauthModel.saveToken(testToken, client, { id: TEST_USER_ID });
	assert(token, "Token should be saved");
	return token.accessToken;
}

const VALID_PDF = Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(64, 0x20)]);
const VALID_HTML = Buffer.from("<html><body>Hello world</body></html>");

const manifest = (entries: { url: string; title?: string; mediaType?: string }[]): string =>
	JSON.stringify(entries);

const useApp = useTestServer();

const ALIAS_URL = "https://example.com/alias-of-saved";
const CANONICAL_URL = "https://example.com/canonical-saved";
const useAliasFoldingApp = useTestServer({
	resolveCanonicalIdentity: async (url: string) => (url === ALIAS_URL ? CANONICAL_URL : url),
});

function setup(): {
	testApp: TestAppHarness;
	publishedSaveHtml: Parameters<PublishSaveLinkRawHtmlCommand>[0][];
	publishedSavePdf: Parameters<PublishSaveLinkRawPdfCommand>[0][];
} {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const publishedSaveHtml: Parameters<PublishSaveLinkRawHtmlCommand>[0][] = [];
	const publishedSavePdf: Parameters<PublishSaveLinkRawPdfCommand>[0][] = [];
	const testApp = useApp({
		...fixture,
		events: {
			...fixture.events,
			publishSaveLinkRawHtmlCommand: async (params) => { publishedSaveHtml.push(params); },
			publishSaveLinkRawPdfCommand: async (params) => { publishedSavePdf.push(params); },
		},
	});
	return { testApp, publishedSaveHtml, publishedSavePdf };
}

describe("POST /queue/save-articles", () => {
	it("tags each saved row with the extension whose token sent the batch", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const provenances: unknown[] = [];
		const testApp = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				saveArticle: async (params) => {
					provenances.push(params.provenance);
					return fixture.articleStore.saveArticle(params);
				},
			},
		});
		const accessToken = await createAccessToken(testApp);

		await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([{ url: "https://example.com/bulk-provenance" }]));

		expect(provenances).toEqual([{ kind: "client", clientName: "firefox" }]);
	});

	it("stamps the pages of one request with consecutive allocator instants in manifest order, minted only after every freshness check resolved", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const allocatorBase = new Date("2031-04-05T06:07:08.090Z");
		let sequenceClaims = 0;
		const events: string[] = [];
		const savedAtByUrl = new Map<string, Date>();
		const testApp = useApp({
			...fixture,
			freshness: {
				refreshArticleIfStale: async ({ url }) => {
					if (url.endsWith("/slow")) {
						await new Promise((resolve) => setTimeout(resolve, 20));
					}
					events.push(`refresh ${url}`);
					return { action: "new" };
				},
			},
			articleStore: {
				...fixture.articleStore,
				allocateSavedAtSequence: async ({ count }) => {
					sequenceClaims += 1;
					return Array.from({ length: count }, (_, i) => new Date(allocatorBase.getTime() + i));
				},
				saveArticle: async (params) => {
					events.push(`save ${params.url}`);
					savedAtByUrl.set(params.url, params.savedAt);
					return fixture.articleStore.saveArticle(params);
				},
			},
		});
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([
				{ url: "https://example.com/slow" },
				{ url: "https://example.com/fast-1" },
				{ url: "https://example.com/fast-2" },
			]));

		expect(response.status).toBe(200);
		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 3, skipped: 0, failed: 0 }),
		);
		expect(events.slice(0, 3).sort()).toEqual([
			"refresh https://example.com/fast-1",
			"refresh https://example.com/fast-2",
			"refresh https://example.com/slow",
		]);
		expect(events[2]).toBe("refresh https://example.com/slow");
		expect(events.slice(3).map((e) => e.split(" ")[0])).toEqual(["save", "save", "save"]);
		expect(sequenceClaims).toBe(1);
		expect(savedAtByUrl.get("https://example.com/slow")).toEqual(allocatorBase);
		expect(savedAtByUrl.get("https://example.com/fast-1")).toEqual(new Date(allocatorBase.getTime() + 1));
		expect(savedAtByUrl.get("https://example.com/fast-2")).toEqual(new Date(allocatorBase.getTime() + 2));
	});

	it("saves the whole press in manifest order when the ranking lookup fails, since ranking only decides position", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const testApp = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				findSavedUrls: async () => {
					throw new Error("user-articles batch get throttled");
				},
			},
		});
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([
				{ url: "https://example.com/rank-a" },
				{ url: "https://example.com/rank-b" },
			]));

		expect(response.status).toBe(200);
		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 2, skipped: 0, failed: 0 }),
		);
		const { articles } = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(articles.map((a) => a.url)).toEqual([
			"https://example.com/rank-b",
			"https://example.com/rank-a",
		]);
	});

	it("ranks a tab whose URL only aliases an already-saved article as a re-save, not as a new link", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const testApp = useAliasFoldingApp(fixture);
		const accessToken = await createAccessToken(testApp);

		const first = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([{ url: CANONICAL_URL }, { url: "https://example.com/companion" }]));
		expect(first.status).toBe(200);

		const second = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([{ url: ALIAS_URL }, { url: "https://example.com/companion" }]));
		expect(second.status).toBe(200);

		const { articles } = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(articles.map((a) => a.url)).toEqual([
			"https://example.com/companion",
			CANONICAL_URL,
		]);
	});

	it("re-saving a window bumps every tab onto fresh consecutive instants and ranks the article deleted from its middle above them", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const testApp = useApp(fixture);
		const accessToken = await createAccessToken(testApp);
		const URL_A = "https://example.com/window-tab-a";
		const URL_B = "https://example.com/window-tab-b";
		const URL_C = "https://example.com/window-tab-c";
		const windowManifest = manifest([{ url: URL_A }, { url: URL_B }, { url: URL_C }]);
		const savedAtOf = async (url: string): Promise<Date> => {
			const { articles } = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
			const row = articles.find((a) => a.url === url);
			assert(row, `${url} must be in the queue`);
			return row.savedAt;
		};
		const bulkSave = () =>
			request(testApp.server)
				.post("/queue/save-articles")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${accessToken}`)
				.field("manifest", windowManifest);

		const first = await bulkSave();
		expect(first.status).toBe(200);
		const firstBatchNewest = await savedAtOf(URL_C);

		const articleB = await testApp.articleStore.findArticleByUrl(URL_B);
		assert(articleB, "B must exist globally after the first save");
		const deletion = await request(testApp.server)
			.post(`/queue/${articleB.id.value}/delete`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);
		expect(deletion.status).toBe(303);

		const second = await bulkSave();
		expect(second.status).toBe(200);
		expect(second.body.properties).toEqual(
			expect.objectContaining({ saved: 3, skipped: 0, failed: 0 }),
		);

		const [savedA, savedB, savedC] = await Promise.all([
			savedAtOf(URL_A),
			savedAtOf(URL_B),
			savedAtOf(URL_C),
		]);
		expect(savedA.getTime()).toBeGreaterThan(firstBatchNewest.getTime());
		expect(savedC.getTime()).toBe(savedA.getTime() + 1);
		expect(savedB.getTime()).toBe(savedC.getTime() + 1);
		const { articles } = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(articles.map((a) => a.url)).toEqual([URL_B, URL_C, URL_A]);
	});

	it("counts a page whose store write throws as failed and still saves the rest of the request", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const testApp = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				saveArticle: async (params) => {
					if (params.url.endsWith("/broken")) throw new Error("write exploded");
					return fixture.articleStore.saveArticle(params);
				},
			},
		});
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([
				{ url: "https://example.com/broken" },
				{ url: "https://example.com/healthy" },
			]));

		expect(response.status).toBe(200);
		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 1, skipped: 0, failed: 1 }),
		);
		const stored = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(stored.articles.map((a) => a.url)).toEqual(["https://example.com/healthy"]);
	});

	it("counts a page whose freshness check throws as failed, saving the rest on a span sized to the surviving pages", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const allocatorBase = new Date("2031-04-05T06:07:08.090Z");
		const claimedCounts: number[] = [];
		const testApp = useApp({
			...fixture,
			freshness: {
				refreshArticleIfStale: async ({ url }) => {
					if (url.endsWith("/broken")) throw new Error("crawl exploded");
					return { action: "new" };
				},
			},
			articleStore: {
				...fixture.articleStore,
				allocateSavedAtSequence: async ({ count }) => {
					claimedCounts.push(count);
					return Array.from({ length: count }, (_, i) => new Date(allocatorBase.getTime() + i));
				},
			},
		});
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([
				{ url: "https://example.com/broken" },
				{ url: "https://example.com/healthy" },
			]));

		expect(response.status).toBe(200);
		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 1, skipped: 0, failed: 1 }),
		);
		expect(claimedCounts).toEqual([1]);
		const stored = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(stored.articles.map((a) => [a.url, a.savedAt.toISOString()])).toEqual([
			["https://example.com/healthy", allocatorBase.toISOString()],
		]);
	});

	it("stamps a single Siren save with the allocator's instant, not the wall clock", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const allocatedSavedAt = new Date("2031-04-05T06:07:08.090Z");
		const testApp = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				allocateSavedAt: async () => allocatedSavedAt,
			},
		});
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ url: "https://example.com/single-allocator" });

		expect(response.status).toBe(201);
		const stored = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(stored.articles.map((a) => [a.url, a.savedAt.toISOString()])).toEqual([
			["https://example.com/single-allocator", allocatedSavedAt.toISOString()],
		]);
	});

	it("ranks the whole press above a save that landed while the press's freshness checks were still running", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		let enterPrepare: () => void = () => {};
		const prepareEntered = new Promise<void>((resolve) => {
			enterPrepare = resolve;
		});
		let releasePrepare: () => void = () => {};
		const prepareGate = new Promise<void>((resolve) => {
			releasePrepare = resolve;
		});
		const testApp = useApp({
			...fixture,
			freshness: {
				refreshArticleIfStale: async ({ url }) => {
					if (url.endsWith("/gated")) {
						enterPrepare();
						await prepareGate;
					}
					return { action: "new" };
				},
			},
		});
		const accessToken = await createAccessToken(testApp);

		const press = request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([
				{ url: "https://example.com/gated" },
				{ url: "https://example.com/companion" },
			]))
			.then((response) => response);
		await prepareEntered;

		await request(testApp.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ url: "https://example.com/competitor" });
		releasePrepare();
		const response = await press;

		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 2, failed: 0 }),
		);
		const stored = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(stored.articles.map((a) => a.url)).toEqual([
			"https://example.com/companion",
			"https://example.com/gated",
			"https://example.com/competitor",
		]);
	});

	it("accepts allocation order over completion order: a save landing during the press's row writes ranks above it, with the press contiguous below", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		let enterWrite: () => void = () => {};
		const writeEntered = new Promise<void>((resolve) => {
			enterWrite = resolve;
		});
		let releaseWrite: () => void = () => {};
		const writeGate = new Promise<void>((resolve) => {
			releaseWrite = resolve;
		});
		const testApp = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				saveArticle: async (params) => {
					if (params.url.endsWith("/gated")) {
						enterWrite();
						await writeGate;
					}
					return fixture.articleStore.saveArticle(params);
				},
			},
		});
		const accessToken = await createAccessToken(testApp);

		const press = request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([
				{ url: "https://example.com/gated" },
				{ url: "https://example.com/companion" },
			]))
			.then((response) => response);
		await writeEntered;

		await request(testApp.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ url: "https://example.com/competitor" });
		releaseWrite();
		const response = await press;

		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 2, failed: 0 }),
		);
		const stored = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(stored.articles.map((a) => a.url)).toEqual([
			"https://example.com/competitor",
			"https://example.com/companion",
			"https://example.com/gated",
		]);
	});

	it("counts every ready page as failed when the position allocator itself fails, still answering with the Siren summary", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const testApp = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				allocateSavedAtSequence: async () => {
					throw new Error("cursor write throttled");
				},
			},
		});
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([
				{ url: "https://example.com/a" },
				{ url: "https://example.com/b" },
			]));

		expect(response.status).toBe(200);
		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 0, skipped: 0, failed: 2 }),
		);
	});

	it("saves a content page, a url-only page, skips an unsaveable scheme, and returns the summary", async () => {
		const { testApp, publishedSaveHtml } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([
				{ url: "https://example.com/a", title: "A", mediaType: "text/html" },
				{ url: "https://example.com/b" },
				{ url: "chrome://settings" },
			]))
			.attach("content-0", VALID_HTML, "content-0");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain(SIREN_MEDIA_TYPE);
		expect(response.body.class).toContain("save-articles-result");
		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 2, skipped: 1, failed: 0, tooBig: [] }),
		);
		expect(response.body.properties.skippedUrls).toEqual([
			{ url: "chrome://settings", code: "unsupported_scheme" },
		]);

		expect(publishedSaveHtml).toEqual([
			expect.objectContaining({ url: "https://example.com/a", title: "A" }),
		]);
		expect(testApp.pendingHtml.readPendingHtml("https://example.com/a")).toBe(
			"<html><body>Hello world</body></html>",
		);

		const stored = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		const urls = stored.articles.map((a) => a.url);
		expect(urls).toContain("https://example.com/a");
		expect(urls).toContain("https://example.com/b");
	});

	it("unwraps a Readplace /view self-URL and saves the underlying original article", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([
				{ url: `${TEST_APP_ORIGIN}/view/fagnerbrack.com/business-success` },
			]));

		expect(response.status).toBe(200);
		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 1, skipped: 0, failed: 0 }),
		);
		const stored = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		const urls = stored.articles.map((a) => a.url);
		expect(urls).toEqual(["https://fagnerbrack.com/business-success"]);
	});

	it("dispatches a pdf content page through the pdf pipeline", async () => {
		const { testApp, publishedSavePdf } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([{ url: "https://example.com/a.pdf", mediaType: "application/pdf" }]))
			.attach("content-0", VALID_PDF, "content-0");

		expect(response.status).toBe(200);
		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 1, skipped: 0, failed: 0 }),
		);
		expect(publishedSavePdf).toEqual([
			expect.objectContaining({ url: "https://example.com/a.pdf" }),
		]);
		expect(testApp.pendingPdf.readPendingPdfSync("https://example.com/a.pdf")).toEqual(VALID_PDF);
	});

	it("saves a content page with an unsupported media type as url-only, staging nothing", async () => {
		const { testApp, publishedSaveHtml, publishedSavePdf } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([{ url: "https://example.com/img", mediaType: "image/png" }]))
			.attach("content-0", Buffer.from("PNG data"), "content-0");

		expect(response.status).toBe(200);
		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 1, skipped: 0, failed: 0, tooBig: [] }),
		);
		expect(publishedSaveHtml).toHaveLength(0);
		expect(publishedSavePdf).toHaveLength(0);
		const stored = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(stored.articles.map((a) => a.url)).toContain("https://example.com/img");
	});

	it("stages a page's capture above the single-save direct budget — only the parser cap bounds a part", async () => {
		const { testApp, publishedSaveHtml } = setup();
		const accessToken = await createAccessToken(testApp);

		const overDirectBudget = Buffer.alloc(MAX_UPLOAD_CONTENT_BYTES + 1, 0x61);
		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([{ url: "https://example.com/big", mediaType: "text/html" }]))
			.attach("content-0", overDirectBudget, "content-0");

		expect(response.status).toBe(200);
		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 1, skipped: 0, failed: 0, tooBig: [] }),
		);
		expect(publishedSaveHtml).toEqual([
			expect.objectContaining({ url: "https://example.com/big" }),
		]);
		expect(testApp.pendingHtml.readPendingHtml("https://example.com/big")).toBe(
			overDirectBudget.toString("utf8"),
		);
		const stored = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(stored.articles.map((a) => a.url)).toContain("https://example.com/big");
	});

	it("saves a page declared with a mediaType but missing its content part as url-only", async () => {
		const { testApp, publishedSaveHtml } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([{ url: "https://example.com/a", mediaType: "text/html" }]));

		expect(response.status).toBe(200);
		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 1, skipped: 0, failed: 0 }),
		);
		expect(publishedSaveHtml).toHaveLength(0);
		const stored = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(stored.articles.map((a) => a.url)).toContain("https://example.com/a");
	});

	it("returns saved 0 (and marks nothing) when every page is an unsaveable scheme", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([{ url: "chrome://settings" }, { url: "file:///etc/hosts" }]));

		expect(response.status).toBe(200);
		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 0, skipped: 2, failed: 0 }),
		);
		const stored = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(stored.articles).toHaveLength(0);
	});

	it("counts a save that throws as failed, never saving it, and logs the error", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errors: Error[] = [];
		const testApp = useApp({
			...fixture,
			freshness: { refreshArticleIfStale: async () => { throw new Error("boom"); } },
			shared: { ...fixture.shared, logError: (_msg, err) => { if (err) errors.push(err); } },
		});
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([{ url: "https://example.com/a" }]));

		expect(response.status).toBe(200);
		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 0, skipped: 0, failed: 1 }),
		);
		expect(errors).toHaveLength(1);
		const stored = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(stored.articles).toHaveLength(0);
	});

	it("logs without an Error value when the underlying save throws a non-Error", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errorArgs: unknown[] = [];
		const testApp = useApp({
			...fixture,
			// biome-ignore lint/suspicious/noExplicitAny: deliberately throws a non-Error to exercise the instanceof Error ? ... : undefined branch
			freshness: { refreshArticleIfStale: async () => { throw "raw string" as any; } },
			shared: { ...fixture.shared, logError: (msg, err) => { errorArgs.push([msg, err]); } },
		});
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([{ url: "https://example.com/a" }]));

		expect(response.status).toBe(200);
		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 0, failed: 1 }),
		);
		expect(errorArgs).toHaveLength(1);
		expect(errorArgs[0]).toEqual(["Failed to bulk-save url=https://example.com/a", undefined]);
	});

	it("returns 422 (save-articles-too-many-pages) when more than MAX_PAGES_PER_BULK_SAVE pages are submitted", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const entries = Array.from(
			{ length: MAX_PAGES_PER_BULK_SAVE + 1 },
			(_v, i) => ({ url: `https://example.com/${i}` }),
		);
		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest(entries));

		expect(response.status).toBe(422);
		expect(response.headers["content-type"]).toContain(SIREN_MEDIA_TYPE);
		expect(response.body.properties.code).toBe("save-articles-too-many-pages");
	});

	it("returns 422 (invalid-save-articles) when the body is not multipart/form-data", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ manifest: "x" });

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-save-articles");
	});

	it("returns 422 when the manifest part is missing", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.attach("content-0", VALID_HTML, "content-0");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-save-articles");
	});

	it("returns 422 when the manifest is not valid JSON", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", "not json{");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-save-articles");
	});

	it("returns 422 when a manifest entry has no url", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", JSON.stringify([{ title: "no url" }]));

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-save-articles");
	});

	it("returns 422 when the manifest is an empty array", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", "[]");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-save-articles");
	});

	it("returns 406 when an authenticated cookie session requests text/html", async () => {
		const { testApp } = setup();
		const agent = await loginAgent(testApp.server, testApp.auth);

		const response = await agent
			.post("/queue/save-articles")
			.set("Accept", "text/html")
			.field("manifest", manifest([{ url: "https://example.com/a" }]));

		expect(response.status).toBe(406);
	});
});

describe("Collection-Siren advertises save-articles action", () => {
	it("advertises save-articles as a multipart content action on the queue collection", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		const saveArticlesAction = response.body.actions.find(
			(a: { name: string }) => a.name === "save-articles",
		);
		expect(saveArticlesAction).toEqual(
			expect.objectContaining({
				href: "/queue/save-articles",
				method: "POST",
				type: "multipart/form-data",
			}),
		);
		const fieldNames = saveArticlesAction.fields.map((f: { name: string }) => f.name);
		expect(fieldNames).toEqual(["manifest", "content"]);
	});

	it("advertises the whole-request byte budget on the content field", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		const saveArticlesAction = response.body.actions.find(
			(a: { name: string }) => a.name === "save-articles",
		);
		const contentField = saveArticlesAction.fields.find((f: { name: string }) => f.name === "content");
		expect(contentField).toEqual(
			expect.objectContaining({ maxBytes: MAX_BULK_PAGE_CONTENT_BYTES, maxRequestBytes: MAX_UPLOAD_REQUEST_BYTES }),
		);
	});
});

describe("POST /queue/save-articles per-entry results", () => {
	it("reports one outcome per manifest entry keyed by the submitted url when variants collapse into one row", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([
				{ url: "https://example.com/story#one" },
				{ url: "https://example.com/story?utm_source=a" },
			]));

		expect(response.status).toBe(200);
		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 2, skipped: 0, failed: 0 }),
		);
		expect(response.body.properties.results.map((r: { url: string }) => r.url)).toEqual([
			"https://example.com/story#one",
			"https://example.com/story?utm_source=a",
		]);
		expect(
			response.body.properties.results.map((r: { outcome: string }) => r.outcome).sort(),
		).toEqual(["created", "merged"]);
		const stored = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(stored.articles).toHaveLength(1);
	});

	it("keeps duplicate manifest entries as distinct results over one stored row", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([
				{ url: "https://example.com/dup" },
				{ url: "https://example.com/dup" },
			]));

		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 2, skipped: 0, failed: 0 }),
		);
		expect(response.body.properties.results.map((r: { url: string }) => r.url)).toEqual([
			"https://example.com/dup",
			"https://example.com/dup",
		]);
		expect(
			response.body.properties.results.map((r: { outcome: string }) => r.outcome).sort(),
		).toEqual(["created", "merged"]);
		const stored = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(stored.articles).toHaveLength(1);
	});

	it("places a skipped entry at its manifest position with its reason code", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([
				{ url: "https://example.com/first" },
				{ url: "chrome://settings" },
				{ url: "https://example.com/second" },
			]));

		expect(response.body.properties.results).toEqual([
			{ url: "https://example.com/first", outcome: "created" },
			{ url: "chrome://settings", outcome: "skipped", code: "unsupported_scheme" },
			{ url: "https://example.com/second", outcome: "created" },
		]);
		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 2, skipped: 1, failed: 0 }),
		);
	});

	it("reports every ready page as failed by its submitted url when the savedAt allocator dies", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const testApp = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				allocateSavedAtSequence: async () => {
					throw new Error("allocator down");
				},
			},
		});
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-articles")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("manifest", manifest([
				{ url: "https://example.com/a" },
				{ url: "https://example.com/b" },
			]));

		expect(response.body.properties).toEqual(
			expect.objectContaining({ saved: 0, skipped: 0, failed: 2 }),
		);
		expect(response.body.properties.results).toEqual([
			{ url: "https://example.com/a", outcome: "failed" },
			{ url: "https://example.com/b", outcome: "failed" },
		]);
		const stored = await testApp.articleStore.findArticlesByUser({ userId: TEST_USER_ID });
		expect(stored.articles).toHaveLength(0);
	});
});
