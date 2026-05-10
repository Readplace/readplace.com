import assert from "node:assert";
import request from "supertest";
import type { Token, Client } from "@node-oauth/oauth2-server";
import { createTestApp, type TestAppResult } from "../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createFakePublishRecrawlLinkInitiated,
	createFakePublishSaveAnonymousLink,
	createNoopLogError,
	initReadabilityParser,
} from "@packages/test-fixtures";

import type { UserId } from "@packages/domain/user";
import { SIREN_MEDIA_TYPE } from "./siren";

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

async function createAccessToken(
	testApp: TestAppResult,
): Promise<string> {
	const client = await testApp.oauthModel.getClient("hutch-firefox-extension", "");
	assert(client, "Test client must exist");

	const testToken = createTestToken();
	const token = await testApp.oauthModel.saveToken(testToken, client, { id: TEST_USER_ID });
	assert(token, "Token should be saved");
	return token.accessToken;
}

describe("GET /queue (Siren content negotiation)", () => {
	it("returns 401 without token when requesting Siren", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(testApp.app)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE);

		expect(response.status).toBe(401);
		expect(response.body.class).toContain("error");
		expect(response.body.properties.code).toBe("missing-token");
	});

	it("returns empty collection for new user", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.app)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.type).toContain("application/vnd.siren+json");
		expect(response.body.class).toContain("collection");
		expect(response.body.class).toContain("articles");
		expect(response.body.properties.total).toBe(0);
		expect(response.body.entities).toEqual([]);
	});

	it("returns articles after saving via HTML form", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		await testApp.auth.createUser({ email: "test@example.com", password: "password123" });
		const agent = request.agent(testApp.app);
		await agent
			.post("/login")
			.type("form")
			.send({ email: "test@example.com", password: "password123" });
		await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/article" });

		const loginResult = await testApp.auth.verifyCredentials({ email: "test@example.com", password: "password123" });
		assert(loginResult.ok);
		const userId = loginResult.userId;

		const client = await testApp.oauthModel.getClient("hutch-firefox-extension", "");
		assert(client);
		const userToken = createTestToken();
		userToken.user = { id: userId };
		const token = await testApp.oauthModel.saveToken(userToken, client, { id: userId });
		assert(token);

		const response = await request(testApp.app)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token.accessToken}`);

		expect(response.status).toBe(200);
		expect(response.body.properties.total).toBe(1);
		expect(response.body.entities).toHaveLength(1);
		expect(response.body.entities[0].rel).toContain("item");
		expect(response.body.entities[0].properties.url).toBe("https://example.com/article");
	});

	it("returns 401 with invalid token", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(testApp.app)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", "Bearer invalid-token");

		expect(response.status).toBe(401);
		expect(response.body.properties.code).toBe("invalid-token");
	});

	it("supports status filter parameter", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.app)
			.get("/queue?status=unread")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.body.class).toContain("collection");
	});

	it("supports order parameter", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.app)
			.get("/queue?order=asc")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.body.class).toContain("collection");
	});

	it("supports page parameter", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.app)
			.get("/queue?page=2")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.body.properties.page).toBe(2);
	});

	it("includes search action", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.app)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		const filterAction = response.body.actions?.find(
			(a: { name: string }) => a.name === "search",
		);
		assert(filterAction, "expected search action");
		expect(filterAction.method).toBe("GET");
		expect(filterAction.fields.map((f: { name: string }) => f.name)).toEqual([
			"status",
			"order",
			"page",
			"pageSize",
			"url",
		]);
	});

	it("includes save-article action", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.app)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		const saveAction = response.body.actions?.find(
			(a: { name: string }) => a.name === "save-article",
		);
		assert(saveAction, "expected save-article action");
		expect(saveAction.method).toBe("POST");
	});
});

describe("POST /queue (Siren save article)", () => {
	it("saves an article and returns Siren entity", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		expect(response.status).toBe(201);
		expect(response.type).toContain("application/vnd.siren+json");
		expect(response.body.class).toContain("article");
		expect(response.body.properties.url).toBe("https://example.com/article");
		expect(response.body.properties.id).toBeDefined();
		expect(response.body.properties.savedAt).toBeDefined();
	});

	it("returns 422 for invalid URL", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "not-a-url" });

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-url");
	});

	it("returns the article collection for a non-saveable scheme when client opts in via Prefer", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/already-saved" });

		const response = await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.set("Prefer", "return=representation")
			.send({ url: "chrome://newtab/" });

		expect(response.status).toBe(422);
		expect(response.body.class).toEqual(["collection", "articles"]);
		expect(response.body.entities).toHaveLength(1);
		expect(response.body.entities[0].properties.url).toBe(
			"https://example.com/already-saved",
		);
	});

	it("preserves the legacy stub-save behaviour for a non-saveable scheme without Prefer", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "chrome://newtab/" });

		expect(response.status).toBe(201);
		expect(response.body.class).toContain("article");
		expect(response.body.properties.url).toBe("chrome://newtab/");
	});

	it("returns 401 without token", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		expect(response.status).toBe(401);
	});

	it("returns 406 when session-authenticated user POSTs without Siren Accept", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await testApp.auth.createUser({ email: "test@example.com", password: "password123" });
		const agent = request.agent(testApp.app);
		await agent
			.post("/login")
			.type("form")
			.send({ email: "test@example.com", password: "password123" });

		const response = await agent
			.post("/queue")
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		expect(response.status).toBe(406);
	});

	it("returns 201 with fallback article when fetch fails", async () => {
		const crawlArticle = async () => ({ status: "failed" as const });
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const { parseArticle } = initReadabilityParser({ crawlArticle, sitePreParsers: [], logError: createNoopLogError() });
		const applyParseResult = createFakeApplyParseResult({
			articleStore: fixture.articleStore,
			articleCrawl: fixture.articleCrawl,
			parseArticle,
		});
		const testApp = createTestApp({
			...fixture,
			parser: { parseArticle, crawlArticle },
			events: {
				publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
				publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
				publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
				publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
				publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
				publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
				publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
			},
		});
		const client = await testApp.oauthModel.getClient("hutch-firefox-extension", "");
		assert(client);
		const testToken = createTestToken();
		const token = await testApp.oauthModel.saveToken(testToken, client, { id: TEST_USER_ID });
		assert(token);

		const response = await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token.accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/broken" });

		expect(response.status).toBe(201);
		expect(response.body.properties.title).toBe("Article from example.com");
	});

	it("includes delete action on saved article", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		const deleteAction = response.body.actions?.find(
			(a: { name: string }) => a.name === "delete",
		);
		assert(deleteAction, "expected delete action");
		expect(deleteAction.method).toBe("POST");
		expect(deleteAction.href).toContain("/delete");
	});
});

describe("POST /queue (Siren re-save read article)", () => {
	it("marks a read article as unread when saved again", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const saveResponse = await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/resave-siren" });

		const articleId = saveResponse.body.properties.id;

		await request(testApp.app)
			.post(`/queue/${articleId}/status`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ status: "read" });

		const resaveResponse = await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/resave-siren" });

		expect(resaveResponse.status).toBe(201);
		expect(resaveResponse.body.properties.status).toBe("unread");

		const listResponse = await request(testApp.app)
			.get("/queue?status=unread")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(listResponse.body.entities).toHaveLength(1);
	});
});

describe("POST /queue/:id/delete (Siren)", () => {
	it("redirects to collection via 303 after deleting when client opts in via Prefer header", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const saveResponse = await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		const articleId = saveResponse.body.properties.id;

		const deleteResponse = await request(testApp.app)
			.post(`/queue/${articleId}/delete`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Prefer", "return=representation")
			.set("Authorization", `Bearer ${accessToken}`)
			.redirects(0);

		expect(deleteResponse.status).toBe(303);
		expect(deleteResponse.headers.location).toBe("/queue");
	});

	it("returns empty collection after following the redirect", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const saveResponse = await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		const articleId = saveResponse.body.properties.id;

		const deleteResponse = await request(testApp.app)
			.post(`/queue/${articleId}/delete`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Prefer", "return=representation")
			.set("Authorization", `Bearer ${accessToken}`)
			.redirects(0);

		assert(deleteResponse.headers.location, "expected Location header");
		const collectionResponse = await request(testApp.app)
			.get(deleteResponse.headers.location)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(collectionResponse.status).toBe(200);
		expect(collectionResponse.body.class).toContain("collection");
		expect(collectionResponse.body.properties.total).toBe(0);
	});

	/** Chrome extension v1.0.66 (still in the web store) sets `redirect: "manual"` on its delete fetch and only treats `status === 204` as success — a 303 surfaces to JS as an opaqueredirect with status 0, leaving the deleted row visible in the popup until reopened. The server keeps returning 204 for Siren clients that don't opt into the new representation flow until v1.0.66 ages out of the wild. */
	it("returns 204 No Content for legacy Siren clients without Prefer header (chrome-extension v1.0.66 backwards compat)", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const saveResponse = await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		const articleId = saveResponse.body.properties.id;

		const deleteResponse = await request(testApp.app)
			.post(`/queue/${articleId}/delete`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.redirects(0);

		expect(deleteResponse.status).toBe(204);
		expect(deleteResponse.text).toBe("");
	});
});

describe("extension-installed cookie middleware", () => {
	it("sets the extension-installed cookie on the Siren entry point before login", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(testApp.app)
			.get("/")
			.set("Accept", SIREN_MEDIA_TYPE)
			.redirects(0);

		expect(response.status).toBe(303);
		const setCookie = response.headers["set-cookie"];
		assert(Array.isArray(setCookie), "expected Set-Cookie header");
		const cookie = setCookie.find((c: string) => c.startsWith("hutch_ext_installed="));
		assert(cookie, "expected hutch_ext_installed cookie");
		expect(cookie).toContain("hutch_ext_installed=1");
		expect(cookie).toContain("Path=/");
		expect(cookie).toContain("SameSite=Lax");
		expect(cookie).toContain("Max-Age=");
	});

	it("does not set the cookie on browser session requests", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await testApp.auth.createUser({ email: "test@example.com", password: "password123" });
		const agent = request.agent(testApp.app);
		await agent
			.post("/login")
			.type("form")
			.send({ email: "test@example.com", password: "password123" });

		const response = await agent
			.get("/queue")
			.set("Accept", "text/html");

		expect(response.status).toBe(200);
		const setCookie = response.headers["set-cookie"];
		const cookies = Array.isArray(setCookie) ? setCookie : [];
		const cookie = cookies.find((c: string) => c.startsWith("hutch_ext_installed="));
		expect(cookie).toBeUndefined();
	});
});

describe("GET / (Siren entry point)", () => {
	it("redirects Siren clients to /queue", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(testApp.app)
			.get("/")
			.set("Accept", SIREN_MEDIA_TYPE)
			.redirects(0);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
	});

	it("returns home page HTML when Accept is not Siren", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(testApp.app)
			.get("/")
			.set("Accept", "text/html");

		expect(response.status).toBe(200);
		expect(response.type).toContain("text/html");
	});

	/** Firefox extensions send a CORS preflight for fetches with non-simple headers (Accept: application/vnd.siren+json, Authorization). Without an OPTIONS handler here the preflight 404s and firefox aborts the fetch with NetworkError. */
	it("handles CORS preflight from extension origin", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(testApp.app)
			.options("/")
			.set("Origin", "moz-extension://d3b07384-d113-4ec6-a7b8-5f7e3b4c9a12")
			.set("Access-Control-Request-Method", "GET")
			.set("Access-Control-Request-Headers", "authorization,accept");

		expect(response.status).toBe(204);
		expect(response.headers["access-control-allow-origin"]).toBe(
			"moz-extension://d3b07384-d113-4ec6-a7b8-5f7e3b4c9a12",
		);
		expect(response.headers["access-control-allow-headers"]?.toLowerCase()).toContain("authorization");
		expect(response.headers["access-control-allow-headers"]?.toLowerCase()).toContain("accept");
	});
});

describe("GET /queue?url= (Siren URL filter)", () => {
	it("returns matching article when URL filter matches", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article-1" });

		await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article-2" });

		const response = await request(testApp.app)
			.get("/queue?url=https://example.com/article-1")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.body.entities).toHaveLength(1);
		expect(response.body.entities[0].properties.url).toBe("https://example.com/article-1");
	});

	it("returns empty collection when URL filter has no match", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		const response = await request(testApp.app)
			.get("/queue?url=https://example.com/nonexistent")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.body.entities).toHaveLength(0);
	});
});

describe("Article sub-entity actions", () => {
	it("includes delete action on article sub-entities in collection", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		await request(testApp.app)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		const response = await request(testApp.app)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		const entity = response.body.entities[0];
		const deleteAction = entity.actions?.find(
			(a: { name: string }) => a.name === "delete",
		);
		assert(deleteAction, "expected delete action on sub-entity");
		expect(deleteAction.method).toBe("POST");
		expect(deleteAction.href).toContain("/delete");
	});
});

describe("Content negotiation", () => {
	it("returns HTML when Accept header is text/html", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await testApp.auth.createUser({ email: "test@example.com", password: "password123" });
		const agent = request.agent(testApp.app);
		await agent
			.post("/login")
			.type("form")
			.send({ email: "test@example.com", password: "password123" });

		const response = await agent
			.get("/queue")
			.set("Accept", "text/html");

		expect(response.status).toBe(200);
		expect(response.type).toContain("text/html");
	});

	it("returns HTML when Accept header is */*", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await testApp.auth.createUser({ email: "test@example.com", password: "password123" });
		const agent = request.agent(testApp.app);
		await agent
			.post("/login")
			.type("form")
			.send({ email: "test@example.com", password: "password123" });

		const response = await agent
			.get("/queue")
			.set("Accept", "*/*");

		expect(response.status).toBe(200);
		expect(response.type).toContain("text/html");
	});

	it("returns Siren when Accept header is application/vnd.siren+json", async () => {
		const testApp = createTestApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(testApp);

		const response = await request(testApp.app)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.type).toContain("application/vnd.siren+json");
	});
});
