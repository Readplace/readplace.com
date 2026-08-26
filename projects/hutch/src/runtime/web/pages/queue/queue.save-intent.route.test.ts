import assert from "node:assert/strict";
import request from "supertest";
import type { Token, Client } from "@node-oauth/oauth2-server";
import type { UserId } from "@packages/domain/user";
import { useTestServer, loginAgent, type TestAppHarness, type TestAppResult } from "../../../test-app";
import type { ViewSaveIntentEvent } from "@packages/web-analytics";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	type TestAppFixture,
} from "@packages/test-fixtures";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { NATIVE_CLIENT_HEADER } from "../../onboarding/native-client";

const TEST_USER_ID = "test-user-save-intent" as UserId;

function createTestToken(): Token {
	return {
		accessToken: "test-access-token-save-intent",
		accessTokenExpiresAt: new Date(Date.now() + 3600000),
		refreshToken: "test-refresh-token-save-intent",
		refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 3600000),
		client: {
			id: "hutch-firefox-extension",
			grants: ["authorization_code", "refresh_token"],
			redirectUris: ["http://127.0.0.1:3000/oauth/callback"],
		} as Client,
		user: { id: TEST_USER_ID },
	};
}

async function bearerToken(testApp: TestAppResult): Promise<string> {
	const client = await testApp.oauthModel.getClient("hutch-firefox-extension", "");
	assert(client, "Test client must exist");
	const token = await testApp.oauthModel.saveToken(createTestToken(), client, { id: TEST_USER_ID });
	assert(token, "Token should be saved");
	return token.accessToken;
}

/** A fixture whose save pipeline throws so the route's catch branch runs — the
 * `outcome: "error"` path. refreshArticleIfStale runs after URL validation, so
 * the emission still has a validated article_host to classify. */
function failingSaveFixture(): TestAppFixture {
	return {
		...createDefaultTestAppFixture(TEST_APP_ORIGIN),
		freshness: { refreshArticleIfStale: async () => { throw new Error("boom"); } },
	};
}

const useApp = useTestServer();

function saveIntents(harness: TestAppHarness): ViewSaveIntentEvent[] {
	return harness.analytics.events.filter(
		(e): e is ViewSaveIntentEvent => e.event === "view_save_intent",
	);
}

describe("view_save_intent — authenticated save surfaces", () => {
	describe("POST /queue/save (queue save bar)", () => {
		it("emits queue_save_bar / saved tagged with is_authenticated=1 and the article's own domain", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/queue/save").type("form").send({ url: "https://example.com/article" });

			expect(response.status).toBe(303);
			const intents = saveIntents(harness);
			assert.equal(intents.length, 1, "exactly one view_save_intent");
			expect(intents[0]).toMatchObject({
				event: "view_save_intent",
				path: "/queue/save",
				article_host: "example.com",
				content_class: "third_party",
				surface: "queue_save_bar",
				outcome: "saved",
				client: "web",
				is_authenticated: 1,
			});
			expect(intents[0].pending_save_id).toBeUndefined();
		});

		it("classifies a save of our own content (fagnerbrack.com) as own", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			await agent.post("/queue/save").type("form").send({ url: "https://fagnerbrack.com/a-post" });

			expect(saveIntents(harness)[0]).toMatchObject({ article_host: "fagnerbrack.com", content_class: "own" });
		});

		it("emits queue_save_bar / error when the save throws", async () => {
			const harness = useApp(failingSaveFixture());
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/queue/save").type("form").send({ url: "https://example.com/article" });

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?error_code=save_failed");
			expect(saveIntents(harness)[0]).toMatchObject({ surface: "queue_save_bar", outcome: "error", is_authenticated: 1 });
		});

		it("emits queue_save_bar / error with a null host when the URL is malformed (422)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/queue/save").type("form").send({ url: "not-a-url" });

			expect(response.status).toBe(422);
			const intents = saveIntents(harness);
			assert.equal(intents.length, 1, "exactly one view_save_intent");
			expect(intents[0]).toMatchObject({
				path: "/queue/save",
				surface: "queue_save_bar",
				outcome: "error",
				article_host: null,
				content_class: null,
				is_authenticated: 1,
			});
		});

		it("emits queue_save_bar / error keeping the parseable host of an unsaveable private-network URL", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const agent = await loginAgent(harness.server, harness.auth);

			const response = await agent.post("/queue/save").type("form").send({ url: "http://localhost/x" });

			expect(response.status).toBe(422);
			expect(saveIntents(harness)[0]).toMatchObject({
				surface: "queue_save_bar",
				outcome: "error",
				article_host: "localhost",
				content_class: "third_party",
			});
		});
	});

	describe("POST /queue (extension save-article)", () => {
		it("emits extension / saved", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const token = await bearerToken(harness);

			const response = await request(harness.server)
				.post("/queue")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${token}`)
				.send({ url: "https://example.com/article" });

			expect(response.status).toBe(201);
			expect(saveIntents(harness)[0]).toMatchObject({
				path: "/queue",
				surface: "extension",
				outcome: "saved",
				content_class: "third_party",
				client: "web",
				is_authenticated: 1,
			});
		});

		it("records the iPhone app's save of the same shape as the ios_app client, which is the only thing telling it apart from a browser extension save", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const token = await bearerToken(harness);

			const response = await request(harness.server)
				.post("/queue")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${token}`)
				.set(NATIVE_CLIENT_HEADER, "ios")
				.send({ url: "https://example.com/article" });

			expect(response.status).toBe(201);
			expect(saveIntents(harness)[0]).toMatchObject({ surface: "extension", client: "ios_app" });
		});

		it("emits extension / error when the save throws", async () => {
			const harness = useApp(failingSaveFixture());
			const token = await bearerToken(harness);

			const response = await request(harness.server)
				.post("/queue")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${token}`)
				.send({ url: "https://example.com/article" });

			expect(response.status).toBe(500);
			expect(saveIntents(harness)[0]).toMatchObject({ surface: "extension", outcome: "error" });
		});

		it("emits extension / error when the URL is malformed (422)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const token = await bearerToken(harness);

			const response = await request(harness.server)
				.post("/queue")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${token}`)
				.send({ url: "not-a-url" });

			expect(response.status).toBe(422);
			const intents = saveIntents(harness);
			assert.equal(intents.length, 1, "exactly one view_save_intent");
			expect(intents[0]).toMatchObject({ path: "/queue", surface: "extension", outcome: "error", article_host: null });
		});
	});

	describe("POST /queue/save-content (extension)", () => {
		it("emits extension / saved", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const token = await bearerToken(harness);

			const response = await request(harness.server)
				.post("/queue/save-content")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${token}`)
				.field("url", "https://example.com/article")
				.field("mediaType", "text/html")
				.attach("content", Buffer.from("<html>captured</html>"), "content");

			expect(response.status).toBe(201);
			expect(saveIntents(harness)[0]).toMatchObject({ path: "/queue/save-content", surface: "extension", outcome: "saved" });
		});

		it("emits extension / error when the save throws", async () => {
			const harness = useApp(failingSaveFixture());
			const token = await bearerToken(harness);

			const response = await request(harness.server)
				.post("/queue/save-content")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${token}`)
				.field("url", "https://example.com/article")
				.field("mediaType", "text/html")
				.attach("content", Buffer.from("<html>captured</html>"), "content");

			expect(response.status).toBe(500);
			expect(saveIntents(harness)[0]).toMatchObject({ surface: "extension", outcome: "error" });
		});

		it("emits extension / error when the URL is malformed (422)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const token = await bearerToken(harness);

			const response = await request(harness.server)
				.post("/queue/save-content")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${token}`)
				.field("url", "not-a-url")
				.field("mediaType", "text/html")
				.attach("content", Buffer.from("<html>captured</html>"), "content");

			expect(response.status).toBe(422);
			expect(saveIntents(harness)[0]).toMatchObject({ path: "/queue/save-content", surface: "extension", outcome: "error", article_host: null });
		});

		it("emits extension / error when the content field is missing (422)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const token = await bearerToken(harness);

			const response = await request(harness.server)
				.post("/queue/save-content")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${token}`)
				.field("url", "https://example.com/article")
				.field("mediaType", "text/html");

			expect(response.status).toBe(422);
			expect(saveIntents(harness)[0]).toMatchObject({ path: "/queue/save-content", surface: "extension", outcome: "error", article_host: "example.com" });
		});

		it("emits extension / error when the mediaType field is missing (422)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const token = await bearerToken(harness);

			const response = await request(harness.server)
				.post("/queue/save-content")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${token}`)
				.field("url", "https://example.com/article")
				.attach("content", Buffer.from("<html>captured</html>"), "content");

			expect(response.status).toBe(422);
			expect(saveIntents(harness)[0]).toMatchObject({ path: "/queue/save-content", surface: "extension", outcome: "error", article_host: "example.com" });
		});

		it("emits extension / saved on an unsupported media type, which degrades to a URL-only save (201)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const token = await bearerToken(harness);

			const response = await request(harness.server)
				.post("/queue/save-content")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${token}`)
				.field("url", "https://example.com/article")
				.field("mediaType", "application/xml")
				.attach("content", Buffer.from("<note>hi</note>"), "content");

			expect(response.status).toBe(201);
			expect(saveIntents(harness)[0]).toMatchObject({ path: "/queue/save-content", surface: "extension", outcome: "saved", article_host: "example.com" });
		});

		it("emits extension / saved when the uploaded bytes are not a PDF, which degrades to a URL-only save (201)", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const token = await bearerToken(harness);

			const response = await request(harness.server)
				.post("/queue/save-content")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${token}`)
				.field("url", "https://example.com/article")
				.field("mediaType", "application/pdf")
				.attach("content", Buffer.from("<html>not a pdf</html>"), "content");

			expect(response.status).toBe(201);
			expect(saveIntents(harness)[0]).toMatchObject({ path: "/queue/save-content", surface: "extension", outcome: "saved", article_host: "example.com" });
		});
	});

	describe("POST /queue/save-articles (extension bulk)", () => {
		it("emits one extension / saved per saved url and nothing for skipped urls, tagged /queue/save-articles", async () => {
			const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
			const token = await bearerToken(harness);

			const response = await request(harness.server)
				.post("/queue/save-articles")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${token}`)
				.field("manifest", JSON.stringify([
					{ url: "https://example.com/a" },
					{ url: "https://fagnerbrack.com/b" },
					{ url: "chrome://settings" },
				]));

			expect(response.status).toBe(200);
			const intents = saveIntents(harness);
			expect(intents).toHaveLength(2);
			expect(intents.every((i) => i.surface === "extension" && i.outcome === "saved" && i.path === "/queue/save-articles")).toBe(true);
			expect(intents.map((i) => i.content_class).sort()).toEqual(["own", "third_party"]);
		});

		it("emits extension / error for a url whose save throws", async () => {
			const harness = useApp(failingSaveFixture());
			const token = await bearerToken(harness);

			const response = await request(harness.server)
				.post("/queue/save-articles")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${token}`)
				.field("manifest", JSON.stringify([{ url: "https://example.com/a" }]));

			expect(response.status).toBe(200);
			expect(saveIntents(harness)[0]).toMatchObject({ path: "/queue/save-articles", surface: "extension", outcome: "error" });
		});
	});
});
