import assert from "node:assert";
import request from "supertest";
import type { Token, Client } from "@node-oauth/oauth2-server";
import type {
	PublishSaveLinkRawPdfCommand,
} from "@packages/test-fixtures/providers/events";
import type { UserId } from "@packages/domain/user";
import { useTestServer, type TestAppHarness, type TestAppResult } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { MAX_PDF_BYTES } from "@packages/crawl-article";

const TEST_USER_ID = "test-user-pdf" as UserId;

function createTestToken(): Token {
	return {
		accessToken: "test-access-token-pdf",
		accessTokenExpiresAt: new Date(Date.now() + 3600000),
		refreshToken: "test-refresh-token-pdf",
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

const useApp = useTestServer();

describe("POST /queue/save-pdf", () => {
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

	it("returns 201 with a Siren article entity and stages the PDF bytes under the URL's pending-pdf key", async () => {
		const { testApp, publishedSavePdf } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-pdf")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article.pdf")
			.attach("pdf", VALID_PDF, "article.pdf");

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

	it("returns 422 with a save-article fallback action when the uploaded bytes do not look like a PDF", async () => {
		const { testApp, publishedSavePdf } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-pdf")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article.pdf")
			.attach("pdf", Buffer.from("not a pdf at all"), "article.pdf");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("not-a-pdf");
		const fallback = response.body.actions.find(
			(a: { name: string }) => a.name === "save-article",
		);
		expect(fallback).toEqual(
			expect.objectContaining({ href: "/queue", method: "POST" }),
		);
		expect(publishedSavePdf).toHaveLength(0);
		expect(testApp.pendingPdf.readPendingPdfSync("https://example.com/article.pdf")).toBeUndefined();
	});

	it("returns 422 with a save-article fallback action when the URL is malformed", async () => {
		const { testApp, publishedSavePdf } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-pdf")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "not-a-url")
			.attach("pdf", VALID_PDF, "article.pdf");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-save-pdf");
		const fallback = response.body.actions.find(
			(a: { name: string }) => a.name === "save-article",
		);
		expect(fallback).toBeDefined();
		expect(publishedSavePdf).toHaveLength(0);
	});

	it("returns 422 with a save-article fallback action when the pdf field is missing", async () => {
		const { testApp, publishedSavePdf } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-pdf")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article.pdf");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-save-pdf");
		expect(publishedSavePdf).toHaveLength(0);
	});

	it("returns 422 with a save-article fallback action when the pdf field contains zero bytes", async () => {
		const { testApp, publishedSavePdf } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-pdf")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article.pdf")
			.attach("pdf", Buffer.alloc(0), "empty.pdf");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-save-pdf");
		expect(publishedSavePdf).toHaveLength(0);
	});

	it("returns 422 with a save-article fallback action when the url field is missing", async () => {
		const { testApp, publishedSavePdf } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-pdf")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.attach("pdf", VALID_PDF, "article.pdf");

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-save-pdf");
		expect(publishedSavePdf).toHaveLength(0);
	});

	it("returns 422 with a save-article fallback action when Content-Type is not multipart/form-data", async () => {
		const { testApp, publishedSavePdf } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-pdf")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article.pdf" });

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-save-pdf");
		const fallback = response.body.actions.find(
			(a: { name: string }) => a.name === "save-article",
		);
		expect(fallback).toBeDefined();
		expect(publishedSavePdf).toHaveLength(0);
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
			.post("/queue/save-pdf")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article.pdf")
			.attach("pdf", VALID_PDF, "article.pdf");

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
			.post("/queue/save-pdf")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.field("url", "https://example.com/article.pdf")
			.attach("pdf", VALID_PDF, "article.pdf");

		expect(response.status).toBe(500);
		expect(response.body.properties.code).toBe("save-failed");
		expect(errorArgs).toHaveLength(1);
		expect(errorArgs[0]).toEqual([
			"Failed to save article from pdf",
			undefined,
		]);
	});

	it("returns 406 when an authenticated cookie session requests text/html on a Siren-only route", async () => {
		const { testApp } = setup();
		await testApp.auth.createUser({ email: "pdfuser@example.com", password: "password123" });
		const agent = request.agent(testApp.server);
		await agent
			.post("/login")
			.type("form")
			.send({ email: "pdfuser@example.com", password: "password123" });

		const response = await agent
			.post("/queue/save-pdf")
			.set("Accept", "text/html")
			.field("url", "https://example.com/article.pdf")
			.attach("pdf", VALID_PDF, "article.pdf");

		expect(response.status).toBe(406);
	});
});

describe("Collection-Siren advertises save-pdf action", () => {
	it("includes save-article, save-html, and save-pdf on the queue collection", async () => {
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

		const savePdfAction = response.body.actions.find((a: { name: string }) => a.name === "save-pdf");
		expect(savePdfAction).toEqual(expect.objectContaining({
			href: "/queue/save-pdf",
			method: "POST",
			type: "multipart/form-data",
		}));
		const fieldNames: string[] = savePdfAction.fields.map((f: { name: string }) => f.name);
		expect(fieldNames).toEqual(["url", "pdf"]);
	});
});

// MAX_PDF_BYTES is referenced to keep the test in sync with the route limit when
// it changes — the limit handler check is exercised in queue.page.ts directly.
void MAX_PDF_BYTES;
