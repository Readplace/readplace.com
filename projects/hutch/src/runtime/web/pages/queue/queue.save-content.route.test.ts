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
import { useTestServer, type TestAppHarness, type TestAppResult } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { MAX_PDF_BYTES } from "@packages/crawl-article";

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
				publishRecrawlLinkInitiated: fixture.events.publishRecrawlLinkInitiated,
				publishSaveAnonymousLink: fixture.events.publishSaveAnonymousLink,
				publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
				publishSaveLinkRawPdfCommand,
				publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
				publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
				publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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

	it("returns 422 with not-a-pdf when mediaType says PDF but bytes lack magic header", async () => {
		const { testApp, publishedSavePdf } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article.pdf")
			.field("mediaType", "application/pdf")
			.attach("content", Buffer.from("not a pdf"), "content");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("not-a-pdf");
		const fallback = response.body.actions.find(
			(a: { name: string }) => a.name === "save-article",
		);
		expect(fallback).toBeDefined();
		expect(publishedSavePdf).toHaveLength(0);
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
				publishRecrawlLinkInitiated: fixture.events.publishRecrawlLinkInitiated,
				publishSaveAnonymousLink: fixture.events.publishSaveAnonymousLink,
				publishSaveLinkRawHtmlCommand,
				publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
				publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
				publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
				publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
				publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
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
		expect(fallback).toBeDefined();
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

	it("returns 422 when the mediaType is unsupported", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-content")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article")
			.field("mediaType", "image/png")
			.attach("content", Buffer.from("PNG data"), "content.png");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("unsupported-media-type");
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
	it("includes save-content alongside save-article, save-html, and save-pdf on the queue collection", async () => {
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
		expect(actionNames).toContain("save-article");
		expect(actionNames).toContain("save-html");
		expect(actionNames).toContain("save-pdf");
		expect(actionNames).toContain("save-content");

		const saveContentAction = response.body.actions.find((a: { name: string }) => a.name === "save-content");
		expect(saveContentAction).toEqual(expect.objectContaining({
			href: "/queue/save-content",
			method: "POST",
			type: "multipart/form-data",
		}));
		const fieldNames: string[] = saveContentAction.fields.map((f: { name: string }) => f.name);
		expect(fieldNames).toEqual(["url", "content", "mediaType", "title"]);
	});
});

void MAX_PDF_BYTES;
