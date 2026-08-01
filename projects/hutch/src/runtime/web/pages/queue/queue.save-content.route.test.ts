import assert from "node:assert";
import request from "supertest";
import type { Token, Client } from "@node-oauth/oauth2-server";
import type {
	PublishSaveLinkRawPdfCommand,
} from "@packages/test-fixtures/providers/events";
import type {
	PublishSaveLinkRawHtmlCommand,
} from "@packages/test-fixtures/providers/events";
import type { UserId } from "@packages/domain/user";
import { MAX_PAGES_PER_BULK_SAVE, MAX_UPLOAD_CONTENT_BYTES, MAX_BULK_PAGE_CONTENT_BYTES, MAX_UPLOAD_REQUEST_BYTES, MAX_UPLOAD_HTML_BYTES } from "@packages/domain/article";
import { MAX_PDF_BYTES } from "@packages/crawl-article";
import { useTestServer, type TestAppHarness, type TestAppResult } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { SIREN_MEDIA_TYPE } from "../../api/siren";

const TEST_USER_ID = "test-user-content" as UserId;

function createTestToken(): Token {
	return {
		accessToken: "test-access-token-content",
		accessTokenExpiresAt: new Date(Date.now() + 3600000),
		refreshToken: "test-refresh-token-content",
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

const useApp = useTestServer();

describe("POST /queue/save-content with PDF", () => {
	function setup(): {
		testApp: TestAppHarness;
		publishedSavePdf: Parameters<PublishSaveLinkRawPdfCommand>[0][];
	} {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const publishedSavePdf: Parameters<PublishSaveLinkRawPdfCommand>[0][] = [];
		const publishSaveLinkRawPdfCommand: PublishSaveLinkRawPdfCommand = async (params) => {
			publishedSavePdf.push(params);
		};

		const testApp = useApp({
			...fixture,
			events: {
				publishLinkSaved: fixture.events.publishLinkSaved,
				publishLinkQueued: fixture.events.publishLinkQueued,
				publishRecrawlLinkInitiated: fixture.events.publishRecrawlLinkInitiated,
				publishSaveAnonymousLink: fixture.events.publishSaveAnonymousLink,
				publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
				publishSaveLinkRawPdfCommand,
				publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
				publishRemoveMyContent: fixture.events.publishRemoveMyContent,
				publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
				publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
				publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
				publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
			},
		});
		return { testApp, publishedSavePdf };
	}

	it("returns 201 and dispatches to the PDF pipeline when mediaType is application/pdf", async () => {
		const { testApp, publishedSavePdf } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article.pdf")
			.field("mediaType", "application/pdf")
			.attach("content", VALID_PDF, "content");

		expect(response.status).toBe(201);
		expect(response.headers["content-type"]).toContain(SIREN_MEDIA_TYPE);
		expect(response.body.properties).toEqual(expect.objectContaining({
			url: "https://example.com/article.pdf",
		}));
		expect(publishedSavePdf).toEqual([
			expect.objectContaining({ url: "https://example.com/article.pdf" }),
		]);
		expect(testApp.pendingPdf.readPendingPdfSync("https://example.com/article.pdf")).toEqual(VALID_PDF);
	});

	it("forwards the captured title to the PDF pipeline", async () => {
		const { testApp, publishedSavePdf } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article.pdf")
			.field("mediaType", "application/pdf")
			.field("title", "Captured PDF Title")
			.attach("content", VALID_PDF, "content");

		expect(response.status).toBe(201);
		expect(publishedSavePdf).toEqual([
			expect.objectContaining({
				url: "https://example.com/article.pdf",
				title: "Captured PDF Title",
			}),
		]);
	});

	it("returns 201 and dispatches to the PDF pipeline when mediaType is application/x-pdf", async () => {
		const { testApp, publishedSavePdf } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article.pdf")
			.field("mediaType", "application/x-pdf")
			.attach("content", VALID_PDF, "content");

		expect(response.status).toBe(201);
		expect(publishedSavePdf).toHaveLength(1);
	});

	it("saves the link URL-only when mediaType says PDF but bytes lack the magic header", async () => {
		const { testApp, publishedSavePdf } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article.pdf")
			.field("mediaType", "application/pdf")
			.attach("content", Buffer.from("not a pdf"), "content");

		expect(response.status).toBe(201);
		expect(response.body.properties).toEqual(expect.objectContaining({
			url: "https://example.com/article.pdf",
		}));
		expect(publishedSavePdf).toHaveLength(0);
		expect(testApp.pendingPdf.readPendingPdfSync("https://example.com/article.pdf")).toBeUndefined();
	});
});

describe("POST /queue/save-content with HTML", () => {
	function setup(): {
		testApp: TestAppHarness;
		publishedSaveHtml: Parameters<PublishSaveLinkRawHtmlCommand>[0][];
	} {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const publishedSaveHtml: Parameters<PublishSaveLinkRawHtmlCommand>[0][] = [];
		const publishSaveLinkRawHtmlCommand: PublishSaveLinkRawHtmlCommand = async (params) => {
			publishedSaveHtml.push(params);
		};

		const testApp = useApp({
			...fixture,
			events: {
				publishLinkSaved: fixture.events.publishLinkSaved,
				publishLinkQueued: fixture.events.publishLinkQueued,
				publishRecrawlLinkInitiated: fixture.events.publishRecrawlLinkInitiated,
				publishSaveAnonymousLink: fixture.events.publishSaveAnonymousLink,
				publishSaveLinkRawHtmlCommand,
				publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
				publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
				publishRemoveMyContent: fixture.events.publishRemoveMyContent,
				publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
				publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
				publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
				publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
			},
		});
		return { testApp, publishedSaveHtml };
	}

	it("returns 201 and dispatches to the HTML pipeline when mediaType is text/html", async () => {
		const { testApp, publishedSaveHtml } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article")
			.field("mediaType", "text/html")
			.field("title", "Test Article")
			.attach("content", VALID_HTML, "content.html");

		expect(response.status).toBe(201);
		expect(response.headers["content-type"]).toContain(SIREN_MEDIA_TYPE);
		expect(response.body.properties).toEqual(expect.objectContaining({
			url: "https://example.com/article",
		}));
		expect(publishedSaveHtml).toEqual([
			expect.objectContaining({
				url: "https://example.com/article",
				title: "Test Article",
			}),
		]);
		expect(testApp.pendingHtml.readPendingHtml("https://example.com/article")).toBe(
			"<html><body>Hello world</body></html>",
		);
	});

	it("returns 201 and dispatches to the HTML pipeline when mediaType is text/html;charset=utf-8", async () => {
		const { testApp, publishedSaveHtml } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article")
			.field("mediaType", "text/html;charset=utf-8")
			.attach("content", VALID_HTML, "content.html");

		expect(response.status).toBe(201);
		expect(publishedSaveHtml).toHaveLength(1);
	});

	it("saves the link URL-only when the mediaType is unsupported, leaving the crawl to enrich it", async () => {
		const { testApp, publishedSaveHtml } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article")
			.field("mediaType", "image/png")
			.attach("content", Buffer.from("PNG data"), "content.png");

		expect(response.status).toBe(201);
		expect(response.body.properties).toEqual(expect.objectContaining({
			url: "https://example.com/article",
		}));
		expect(publishedSaveHtml).toHaveLength(0);
		expect(testApp.pendingHtml.readPendingHtml("https://example.com/article")).toBeUndefined();
	});
});

describe("POST /queue/save-content validation", () => {
	function setup(): { testApp: TestAppHarness } {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const testApp = useApp({ ...fixture });
		return { testApp };
	}

	it("returns 422 when Content-Type is not multipart/form-data", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-save-content");
		const fallback = response.body.actions.find(
			(a: { name: string }) => a.name === "save-article",
		);
		expect(fallback).toEqual(
			expect.objectContaining({ title: "Save a link", href: "/queue" }),
		);
	});

	it("returns 422 when the content field is missing", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article")
			.field("mediaType", "text/html");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-save-content");
	});

	it("returns 422 when the mediaType field is missing", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article")
			.attach("content", VALID_HTML, "content.html");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-save-content");
	});

	it("returns 422 when the url is malformed", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "not-a-url")
			.field("mediaType", "text/html")
			.attach("content", VALID_HTML, "content.html");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-save-content");
		const fallback = response.body.actions.find(
			(a: { name: string }) => a.name === "save-article",
		);
		expect(fallback).toBeDefined();
	});

	it("returns 500 when the underlying article save throws", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errors: Error[] = [];

		const testApp = useApp({
			...fixture,
			freshness: { refreshArticleIfStale: async () => { throw new Error("boom"); } },
			shared: {
				...fixture.shared,
				logError: (_msg, err) => { if (err) errors.push(err); },
			},
		});
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article")
			.field("mediaType", "text/html")
			.attach("content", VALID_HTML, "content.html");

		expect(response.status).toBe(500);
		expect(response.body.properties.code).toBe("save-failed");
		expect(errors).toHaveLength(1);
	});

	it("returns 500 and skips the Error coercion branch when the downstream throws a non-Error value", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errorArgs: unknown[] = [];

		const testApp = useApp({
			...fixture,
			// biome-ignore lint/suspicious/noExplicitAny: deliberately throws a non-Error to exercise the instanceof Error ? ... : undefined branch
			freshness: { refreshArticleIfStale: async () => { throw "raw string" as any; } },
			shared: {
				...fixture.shared,
				logError: (msg, err) => { errorArgs.push([msg, err]); },
			},
		});
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article")
			.field("mediaType", "text/html")
			.attach("content", VALID_HTML, "content.html");

		expect(response.status).toBe(500);
		expect(response.body.properties.code).toBe("save-failed");
		expect(errorArgs).toHaveLength(1);
		expect(errorArgs[0]).toEqual([
			"Failed to save article from content",
			undefined,
		]);
	});

	it("returns 406 when an authenticated cookie session requests text/html on a Siren-only route", async () => {
		const { testApp } = setup();
		await testApp.auth.createUser({ email: "contentuser@example.com", password: "password123" });
		const agent = request.agent(testApp.server);
		await agent
			.post("/login")
			.type("form")
			.send({ email: "contentuser@example.com", password: "password123" });

		const response = await agent
			.post("/queue/save-content")
			.set("Accept", "text/html")
			.field("url", "https://example.com/article")
			.field("mediaType", "text/html")
			.attach("content", VALID_HTML, "content.html");

		expect(response.status).toBe(406);
	});
});

describe("Collection-Siren advertises save-content action", () => {
	it("advertises save-content alongside save-article", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const testApp = useApp({
			...fixture,
		});
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		const actionNames: string[] = response.body.actions.map((a: { name: string }) => a.name);
		expect(actionNames).toEqual([
			"save-article",
			"save-articles",
			"save-content",
			"search",
			"create-session",
		]);

		const saveContentAction = response.body.actions.find((a: { name: string }) => a.name === "save-content");
		expect(saveContentAction).toEqual(expect.objectContaining({
			href: "/queue/save-content",
			method: "POST",
			type: "multipart/form-data",
		}));
		const fieldNames: string[] = saveContentAction.fields.map((f: { name: string }) => f.name);
		expect(fieldNames).toEqual(["url", "content", "mediaType", "title", "size"]);
	});

	it("declares the byte ceiling on save-content's content field", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const testApp = useApp({ ...fixture });
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		const saveContent = response.body.actions.find((a: { name: string }) => a.name === "save-content");
		const contentField = saveContent.fields.find((f: { name: string }) => f.name === "content");
		expect(contentField.maxBytes).toBe(MAX_UPLOAD_CONTENT_BYTES);
	});

	it("declares the page and byte ceilings on save-articles' fields", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const testApp = useApp({ ...fixture });
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		const saveArticles = response.body.actions.find((a: { name: string }) => a.name === "save-articles");
		const manifestField = saveArticles.fields.find((f: { name: string }) => f.name === "manifest");
		const contentField = saveArticles.fields.find((f: { name: string }) => f.name === "content");
		expect(manifestField.maxItems).toBe(MAX_PAGES_PER_BULK_SAVE);
		expect(contentField.maxBytes).toBe(MAX_BULK_PAGE_CONTENT_BYTES);
	});
});

describe("POST /queue/save-content over the request limit", () => {
	it("refuses with content-too-large and advertises the save-article fallback", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const testApp = useApp({ ...fixture });
		const accessToken = await createAccessToken(testApp);
		const oversize = Buffer.concat([
			Buffer.from("%PDF-1.4"),
			Buffer.alloc(MAX_UPLOAD_REQUEST_BYTES, 0x20),
		]);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article.pdf")
			.field("mediaType", "application/pdf")
			.attach("content", oversize, "content");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("content-too-large");
		expect(response.body.actions).toEqual([
			expect.objectContaining({ name: "save-article", method: "POST" }),
		]);
	});

	it("accepts a capture at the advertised content budget", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const testApp = useApp({ ...fixture });
		const accessToken = await createAccessToken(testApp);
		const atBudget = Buffer.concat([
			Buffer.from("%PDF-1.4"),
			Buffer.alloc(MAX_UPLOAD_CONTENT_BYTES - 8, 0x20),
		]);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article.pdf")
			.field("mediaType", "application/pdf")
			.attach("content", atBudget, "content");

		expect(response.status).toBe(201);
	});
});


describe("POST /queue/save-content upload-slot flow", () => {
	function setupUpload(): {
		testApp: TestAppHarness;
		publishedSavePdf: Parameters<PublishSaveLinkRawPdfCommand>[0][];
		publishedSaveHtml: Parameters<PublishSaveLinkRawHtmlCommand>[0][];
	} {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const publishedSavePdf: Parameters<PublishSaveLinkRawPdfCommand>[0][] = [];
		const publishedSaveHtml: Parameters<PublishSaveLinkRawHtmlCommand>[0][] = [];
		const testApp = useApp({
			...fixture,
			events: {
				...fixture.events,
				publishSaveLinkRawPdfCommand: async (params) => { publishedSavePdf.push(params); },
				publishSaveLinkRawHtmlCommand: async (params) => { publishedSaveHtml.push(params); },
			},
		});
		return { testApp, publishedSavePdf, publishedSaveHtml };
	}

	const PDF_URL = "https://example.com/big.pdf";

	it("grants an upload slot for a large PDF, advertising the presigned PUT and completion actions", async () => {
		const { testApp } = setupUpload();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", PDF_URL)
			.field("mediaType", "application/pdf")
			.field("title", "Big Doc")
			.field("size", String(50 * 1024 * 1024));

		expect(response.status).toBe(200);
		expect(response.body.class).toEqual(["upload-slot"]);
		expect(typeof response.body.properties.expiresAt).toBe("string");
		const actionNames: string[] = response.body.actions.map((a: { name: string }) => a.name);
		expect(actionNames).toEqual(["upload-content", "save-uploaded-content"]);
		const upload = response.body.actions.find((a: { name: string }) => a.name === "upload-content");
		expect(upload).toEqual(expect.objectContaining({ method: "PUT", type: "application/pdf" }));
		expect(typeof upload.href).toBe("string");
		const complete = response.body.actions.find((a: { name: string }) => a.name === "save-uploaded-content");
		expect(complete).toEqual(expect.objectContaining({ href: "/queue/save-content", method: "POST" }));
		const byName = Object.fromEntries(complete.fields.map((f: { name: string; value?: string }) => [f.name, f.value]));
		expect(byName).toEqual({ url: PDF_URL, mediaType: "application/pdf", title: "Big Doc", uploaded: "true" });
	});

	it("refuses a slot when the declared size exceeds the PDF ceiling", async () => {
		const { testApp } = setupUpload();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", PDF_URL)
			.field("mediaType", "application/pdf")
			.field("size", String(MAX_PDF_BYTES.bytes + 1));

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("content-too-large");
		expect(response.body.actions).toEqual([expect.objectContaining({ name: "save-article" })]);
	});

	it("refuses a slot for an unsupported media type", async () => {
		const { testApp } = setupUpload();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", PDF_URL)
			.field("mediaType", "image/png")
			.field("size", "1000");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("unsupported-media-type");
	});

	it("refuses a slot for an unsaveable URL", async () => {
		const { testApp } = setupUpload();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "chrome://settings")
			.field("mediaType", "application/pdf")
			.field("size", "1000");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-save-content");
	});

	it("refuses a slot request missing the mediaType", async () => {
		const { testApp } = setupUpload();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", PDF_URL)
			.field("size", "1000");

		expect(response.status).toBe(422);
		expect(response.body.properties.message).toContain("mediaType");
	});

	it("completes a PDF upload, forwarding the title and publishing the raw-pdf command", async () => {
		const { testApp, publishedSavePdf } = setupUpload();
		const accessToken = await createAccessToken(testApp);
		await testApp.pendingUpload.stageUploaded({ url: PDF_URL, mediaType: "application/pdf", bytes: VALID_PDF });

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", PDF_URL)
			.field("mediaType", "application/pdf")
			.field("title", "Big Doc")
			.field("uploaded", "true");

		expect(response.status).toBe(201);
		expect(response.body.properties).toEqual(expect.objectContaining({ url: PDF_URL }));
		expect(publishedSavePdf).toEqual([expect.objectContaining({ url: PDF_URL, title: "Big Doc" })]);
	});

	it("completes an HTML upload, publishing the raw-html command", async () => {
		const { testApp, publishedSaveHtml } = setupUpload();
		const accessToken = await createAccessToken(testApp);
		const url = "https://example.com/big.html";
		await testApp.pendingUpload.stageUploaded({ url, mediaType: "text/html", bytes: VALID_HTML });

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", url)
			.field("mediaType", "text/html")
			.field("title", "Big Page")
			.field("uploaded", "true");

		expect(response.status).toBe(201);
		expect(publishedSaveHtml).toEqual([expect.objectContaining({ url, title: "Big Page" })]);
	});

	it("refuses completion when no upload was staged", async () => {
		const { testApp } = setupUpload();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", PDF_URL)
			.field("mediaType", "application/pdf")
			.field("uploaded", "true");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("upload-not-found");
	});

	it("refuses completion when the staged bytes are not a PDF", async () => {
		const { testApp, publishedSavePdf } = setupUpload();
		const accessToken = await createAccessToken(testApp);
		await testApp.pendingUpload.stageUploaded({ url: PDF_URL, mediaType: "application/pdf", bytes: Buffer.from("not a pdf at all") });

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", PDF_URL)
			.field("mediaType", "application/pdf")
			.field("uploaded", "true");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("not-a-pdf");
		expect(publishedSavePdf).toHaveLength(0);
	});

	it("refuses completion when the staged object is stale", async () => {
		const { testApp } = setupUpload();
		const accessToken = await createAccessToken(testApp);
		await testApp.pendingUpload.stageUploaded({
			url: PDF_URL,
			mediaType: "application/pdf",
			bytes: VALID_PDF,
			stagedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
		});

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", PDF_URL)
			.field("mediaType", "application/pdf")
			.field("uploaded", "true");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("upload-not-found");
	});

	it("refuses completion when the staged object exceeds the ceiling", async () => {
		const { testApp } = setupUpload();
		const accessToken = await createAccessToken(testApp);
		const url = "https://example.com/huge.html";
		await testApp.pendingUpload.stageUploaded({
			url,
			mediaType: "text/html",
			bytes: Buffer.alloc(MAX_UPLOAD_HTML_BYTES + 1, 0x61),
		});

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", url)
			.field("mediaType", "text/html")
			.field("uploaded", "true");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("content-too-large");
	});

	it("refuses a request that is neither a direct save, a slot request, nor a completion", async () => {
		const { testApp } = setupUpload();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", PDF_URL)
			.field("mediaType", "application/pdf");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-save-content");
	});

	it("treats uploaded=false and a non-positive size as an invalid request", async () => {
		const { testApp } = setupUpload();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", PDF_URL)
			.field("mediaType", "application/pdf")
			.field("uploaded", "false")
			.field("size", "0");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-save-content");
	});
});
