import assert from "node:assert";
import request from "supertest";
import type { Token, Client } from "@node-oauth/oauth2-server";
import type { PublishSaveLinkRawHtmlCommand } from "@packages/test-fixtures/providers/events";
import type { UserId } from "@packages/domain/user";
import { useTestServer, type TestAppHarness, type TestAppResult } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { MAX_RAW_HTML_BYTES, MAX_RAW_HTML_REQUEST_BYTES } from "@packages/domain/article";

const TEST_USER_ID = "test-user-123" as UserId;

function createTestToken(): Token {
	return {
		accessToken: "test-access-token",
		accessTokenExpiresAt: new Date(Date.now() + 3600000),
		refreshToken: "test-refresh-token",
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

const useApp = useTestServer();

describe("POST /queue/save-html", () => {
	function setup(): {
		testApp: TestAppHarness;
		pendingHtml: TestAppHarness["pendingHtml"];
		publishedSaveHtml: Parameters<PublishSaveLinkRawHtmlCommand>[0][];
		publishedLinkSaved: { url: string; userId: string }[];
	} {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const publishedSaveHtml: Parameters<PublishSaveLinkRawHtmlCommand>[0][] = [];
		const publishedLinkSaved: { url: string; userId: string }[] = [];
		const fakePublishLinkSaved = fixture.events.publishLinkSaved;
		const publishSaveLinkRawHtmlCommand: PublishSaveLinkRawHtmlCommand = async (params) => {
			publishedSaveHtml.push(params);
		};

		const testApp = useApp({
			...fixture,
			events: {
				publishLinkSaved: async (params) => {
					publishedLinkSaved.push(params);
					await fakePublishLinkSaved(params);
				},
				publishRecrawlLinkInitiated: fixture.events.publishRecrawlLinkInitiated,
				publishSaveAnonymousLink: fixture.events.publishSaveAnonymousLink,
				publishSaveLinkRawHtmlCommand: publishSaveLinkRawHtmlCommand,
				publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
				publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
				publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
				publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
			},
		});
		return { testApp, pendingHtml: testApp.pendingHtml, publishedSaveHtml, publishedLinkSaved };
	}

	it("returns 201 with a Siren article entity", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-html")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				url: "https://example.com/article",
				rawHtml: "<html><body><p>captured</p></body></html>",
				title: "Captured",
			});

		expect(response.status).toBe(201);
		expect(response.headers["content-type"]).toContain(SIREN_MEDIA_TYPE);
		expect(response.body.properties).toEqual(expect.objectContaining({
			url: "https://example.com/article",
		}));
	});

	it("publishes both SaveLinkRawHtmlCommand and LinkSaved (Tier 1 still runs)", async () => {
		const { testApp, publishedSaveHtml, publishedLinkSaved } = setup();
		const accessToken = await createAccessToken(testApp);

		await request(testApp.server)
			.post("/queue/save-html")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				url: "https://example.com/article",
				rawHtml: "<html>captured</html>",
				title: "Captured",
			});

		expect(publishedLinkSaved).toHaveLength(1);
		expect(publishedLinkSaved[0]).toEqual(expect.objectContaining({
			url: "https://example.com/article",
		}));
		expect(publishedSaveHtml).toHaveLength(1);
		expect(publishedSaveHtml[0]).toEqual(expect.objectContaining({
			url: "https://example.com/article",
			title: "Captured",
		}));
	});

	it("stores the rawHtml under the URL's pending-html key", async () => {
		const { testApp, pendingHtml } = setup();
		const accessToken = await createAccessToken(testApp);

		await request(testApp.server)
			.post("/queue/save-html")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				url: "https://example.com/article",
				rawHtml: "<html>captured</html>",
			});

		expect(pendingHtml.readPendingHtml("https://example.com/article")).toBe("<html>captured</html>");
	});

	it("returns 500 when the underlying article save throws", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const errors: Error[] = [];

		const testApp = useApp({
			...fixture,
			events: {
				publishLinkSaved: fixture.events.publishLinkSaved,
				publishRecrawlLinkInitiated: fixture.events.publishRecrawlLinkInitiated,
				publishSaveAnonymousLink: fixture.events.publishSaveAnonymousLink,
				publishSaveLinkRawHtmlCommand: async () => {},
				publishSaveLinkRawPdfCommand: async () => {},
				publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
				publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
				publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
			},
			freshness: { refreshArticleIfStale: async () => { throw new Error("boom"); } },
			shared: {
				validateSaveableUrl: fixture.shared.validateSaveableUrl,
				appOrigin: fixture.shared.appOrigin,
				staticBaseUrl: fixture.shared.staticBaseUrl,
				httpErrorMessageMapping: fixture.shared.httpErrorMessageMapping,
				logError: (_msg, err) => { if (err) errors.push(err); },
				logParseError: fixture.shared.logParseError,
				now: fixture.shared.now,
			},
		});
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-html")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({
				url: "https://example.com/article",
				rawHtml: "<html>captured</html>",
			});

		expect(response.status).toBe(500);
		expect(response.body.properties.code).toBe("save-failed");
		expect(errors).toHaveLength(1);
	});

	it("returns 201 via URL-only fallback when rawHtml exceeds MAX_RAW_HTML_BYTES but fits within the body-parser limit", async () => {
		const { testApp, publishedSaveHtml, publishedLinkSaved, pendingHtml } = setup();
		const accessToken = await createAccessToken(testApp);

		const oversized = "x".repeat(MAX_RAW_HTML_BYTES + 1024);
		const response = await request(testApp.server)
			.post("/queue/save-html")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ url: "https://example.com/article", rawHtml: oversized });

		expect(response.status).toBe(201);
		expect(response.headers["content-type"]).toContain(SIREN_MEDIA_TYPE);
		expect(response.body.properties).toEqual(expect.objectContaining({
			url: "https://example.com/article",
		}));
		expect(publishedSaveHtml).toHaveLength(0);
		expect(publishedLinkSaved).toHaveLength(1);
		expect(pendingHtml.readPendingHtml("https://example.com/article")).toBeUndefined();
	});

	it("returns 422 when rawHtml is oversized but the URL is also invalid (unrecoverable)", async () => {
		const { testApp, publishedSaveHtml, publishedLinkSaved } = setup();
		const accessToken = await createAccessToken(testApp);

		const oversized = "x".repeat(MAX_RAW_HTML_BYTES + 1024);
		const response = await request(testApp.server)
			.post("/queue/save-html")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ url: "not-a-url", rawHtml: oversized });

		expect(response.status).toBe(422);
		expect(response.headers["content-type"]).toContain(SIREN_MEDIA_TYPE);
		expect(response.body.properties.code).toBe("invalid-save-html");
		expect(publishedSaveHtml).toHaveLength(0);
		expect(publishedLinkSaved).toHaveLength(0);
	});

	it("returns 500 with a save-article fallback action when the request body exceeds MAX_RAW_HTML_REQUEST_BYTES", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const oversized = "x".repeat(MAX_RAW_HTML_REQUEST_BYTES + 1024);
		const response = await request(testApp.server)
			.post("/queue/save-html")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ url: "https://example.com/article", rawHtml: oversized });

		expect(response.status).toBe(500);
		expect(response.headers["content-type"]).toContain(SIREN_MEDIA_TYPE);
		expect(response.body.properties.code).toBe("html-too-large");
		const mb = MAX_RAW_HTML_REQUEST_BYTES / (1024 * 1024);
		expect(response.body.properties.message).toContain(`${mb}MB`);
		const fallback = response.body.actions.find(
			(a: { name: string }) => a.name === "save-article",
		);
		expect(fallback).toEqual(
			expect.objectContaining({ href: "/queue", method: "POST" }),
		);
		const fallbackFields = fallback.fields.map((f: { name: string }) => f.name);
		expect(fallbackFields).toEqual(["url"]);
	});

	it("logs a parse-failure event with url=null and reason=payload-too-large when the body-parser rejects an oversized payload", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const parseErrorCalls: { url: string | null; reason: string }[] = [];

		const testApp = useApp({
			...fixture,
			shared: {
				validateSaveableUrl: fixture.shared.validateSaveableUrl,
				appOrigin: fixture.shared.appOrigin,
				staticBaseUrl: fixture.shared.staticBaseUrl,
				httpErrorMessageMapping: fixture.shared.httpErrorMessageMapping,
				logError: () => {},
				logParseError: (params) => { parseErrorCalls.push(params); },
				now: fixture.shared.now,
			},
		});
		const accessToken = await createAccessToken(testApp);

		const oversized = "x".repeat(MAX_RAW_HTML_REQUEST_BYTES + 1);
		await request(testApp.server)
			.post("/queue/save-html")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ url: "https://example.com/article", rawHtml: oversized });

		expect(parseErrorCalls).toEqual([
			{ url: null, reason: "payload-too-large" },
		]);
	});

	it("returns 422 when the body fails schema validation", async () => {
		const { testApp } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue/save-html")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ url: "not-a-url", rawHtml: "" });

		expect(response.status).toBe(422);
		expect(response.headers["content-type"]).toContain(SIREN_MEDIA_TYPE);
	});

	it("returns 406 when an authenticated cookie session requests text/html on a Siren-only route", async () => {
		const { testApp } = setup();
		await testApp.auth.createUser({ email: "test@example.com", password: "password123" });
		const agent = request.agent(testApp.server);
		await agent
			.post("/login")
			.type("form")
			.send({ email: "test@example.com", password: "password123" });

		const response = await agent
			.post("/queue/save-html")
			.set("Accept", "text/html")
			.send({
				url: "https://example.com/article",
				rawHtml: "<html>captured</html>",
			});

		expect(response.status).toBe(406);
	});

	it("does not affect the legacy POST /queue (Siren save-article still works)", async () => {
		const { testApp, publishedSaveHtml, publishedLinkSaved } = setup();
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.send({ url: "https://example.com/article" });

		expect(response.status).toBe(201);
		expect(publishedLinkSaved).toHaveLength(1);
		expect(publishedSaveHtml).toHaveLength(0);
	});
});

describe("Collection-Siren advertises both save actions", () => {
	it("includes both save-article and save-html actions on the queue collection", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const testApp = useApp({
			...fixture,
			events: {
				publishLinkSaved: fixture.events.publishLinkSaved,
				publishRecrawlLinkInitiated: fixture.events.publishRecrawlLinkInitiated,
				publishSaveAnonymousLink: fixture.events.publishSaveAnonymousLink,
				publishSaveLinkRawHtmlCommand: async () => {},
				publishSaveLinkRawPdfCommand: async () => {},
				publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
				publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
				publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
					publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
					publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
			},
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

		const saveHtmlAction = response.body.actions.find((a: { name: string }) => a.name === "save-html");
		expect(saveHtmlAction).toEqual(expect.objectContaining({
			href: "/queue/save-html",
			method: "POST",
			type: "application/json",
		}));
		const fieldNames = saveHtmlAction.fields.map((f: { name: string }) => f.name);
		expect(fieldNames).toEqual(expect.arrayContaining(["url", "rawHtml", "title"]));
	});
});
