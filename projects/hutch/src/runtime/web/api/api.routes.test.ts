import assert from "node:assert";
import request from "supertest";
import { loginAgent, useTestServer } from "../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createFakePublishRecrawlLinkInitiated,
	createFakePublishSaveAnonymousLink,
	createNoopLogError,
} from "@packages/test-fixtures";
import { initReadabilityParser } from "@packages/article-parser";
import { MinutesSchema } from "@packages/domain/article";
import { READLIST_MAX_PER_USER, ReadlistSlugSchema } from "@packages/domain/readlist";

import { SIREN_MEDIA_TYPE } from "./siren";
import { parseReadlistUrl } from "../pages/readlist/readlist.url";
import { NATIVE_CLIENT_HEADER } from "../onboarding/native-client";
import { SIREN_DISCOVERY_MAX_AGE_SECONDS } from "../siren-discovery-cache";
import {
	createAccessToken,
	saveAccessTokenForClient,
	saveAccessTokenForUser,
} from "../test-helpers/oauth-token";

const useApp = useTestServer();

async function loginAndSave(
	harness: ReturnType<typeof useApp>,
	params: { email: string; urlCount: number },
) {
	await harness.auth.createUser({ email: params.email, password: "password123" });
	const agent = request.agent(harness.server);
	await agent
		.post("/login")
		.type("form")
		.send({ email: params.email, password: "password123" });
	for (let i = 0; i < params.urlCount; i++) {
		await agent
			.post("/queue/save")
			.type("form")
			.send({ url: `https://example.com/article-${i}` });
	}
	const loginResult = await harness.auth.verifyCredentials({
		email: params.email,
		password: "password123",
	});
	assert(loginResult.ok);
	return loginResult.userId;
}

describe("GET /queue (Siren content negotiation)", () => {
	it("returns 401 without token when requesting Siren", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE);

		expect(response.status).toBe(401);
		expect(response.body.class).toContain("error");
		expect(response.body.properties.code).toBe("missing-token");
	});

	it("returns empty collection for new user", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.type).toContain("application/vnd.siren+json");
		expect(response.body.class).toContain("collection");
		expect(response.body.class).toContain("articles");
		expect(response.body.entities).toEqual([]);
	});

	it("returns articles after saving via HTML form", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		await harness.auth.createUser({ email: "test@example.com", password: "password123" });
		const agent = request.agent(harness.server);
		await agent
			.post("/login")
			.type("form")
			.send({ email: "test@example.com", password: "password123" });
		await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/article" });

		const loginResult = await harness.auth.verifyCredentials({ email: "test@example.com", password: "password123" });
		assert(loginResult.ok);
		const userId = loginResult.userId;

		const accessToken = await saveAccessTokenForUser(harness, userId);

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.body.entities).toHaveLength(1);
		expect(response.body.entities[0].rel).toContain("item");
		expect(response.body.entities[0].properties.url).toBe("https://example.com/article");
	});

	it("returns 401 with invalid token", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", "Bearer invalid-token");

		expect(response.status).toBe(401);
		expect(response.body.properties.code).toBe("invalid-token");
	});

	it("supports status filter parameter", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const response = await request(harness.server)
			.get("/queue?status=unread")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.body.class).toContain("collection");
	});

	it("supports order parameter", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const response = await request(harness.server)
			.get("/queue?order=asc")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.body.class).toContain("collection");
	});

	it("supports page parameter", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const response = await request(harness.server)
			.get("/queue?page=2")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		const selfLink = response.body.links?.find(
			(l: { rel: string[] }) => l.rel.includes("self"),
		);
		expect(selfLink?.href).toContain("page=2");
	});

	it("pages a browser extension at the size its popup displays", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const userId = await loginAndSave(harness, { email: "ext@example.com", urlCount: 11 });
		const accessToken = await saveAccessTokenForClient(harness, {
			userId,
			clientId: "hutch-chrome-extension",
		});

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.body.entities).toHaveLength(10);
		expect(response.body.properties.pageSize).toBe(10);
		expect(response.body.properties.pages).toEqual([
			{ label: "1", rel: "current", href: "/queue?status=unread&page=1" },
			{ label: "2", rel: "next", href: "/queue?status=unread&page=2" },
		]);
	});

	it("keeps the iPhone app on the default page size", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const userId = await loginAndSave(harness, { email: "ios@example.com", urlCount: 11 });
		const accessToken = await saveAccessTokenForClient(harness, { userId, clientId: "ios-app" });

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.body.entities).toHaveLength(11);
		expect(response.body.properties.pageSize).toBe(20);
		expect(response.body.properties.pages).toEqual([
			{ label: "1", rel: "current", href: "/queue?status=unread&page=1" },
		]);
	});

	it("advertises the pages around the one it served", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const userId = await loginAndSave(harness, { email: "pages@example.com", urlCount: 25 });
		const accessToken = await saveAccessTokenForClient(harness, {
			userId,
			clientId: "hutch-chrome-extension",
		});

		const response = await request(harness.server)
			.get("/queue?page=2")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.body.properties.pages).toEqual([
			{ label: "1", rel: "prev", href: "/queue?status=unread&page=1" },
			{ label: "2", rel: "current", href: "/queue?status=unread&page=2" },
			{ label: "3", rel: "next", href: "/queue?status=unread&page=3" },
		]);
	});

	it("advertises a single page when a url filter narrows the collection", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const userId = await loginAndSave(harness, { email: "filter@example.com", urlCount: 11 });
		const accessToken = await saveAccessTokenForClient(harness, {
			userId,
			clientId: "hutch-chrome-extension",
		});

		const response = await request(harness.server)
			.get("/queue?url=https%3A%2F%2Fexample.com%2Farticle-3")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.body.entities).toHaveLength(1);
		expect(response.body.properties.pages).toEqual([
			{
				label: "1",
				rel: "current",
				href: "/queue?status=unread&page=1&url=https%3A%2F%2Fexample.com%2Farticle-3",
			},
		]);
	});

	it("includes search action", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const response = await request(harness.server)
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
			"url",
		]);
	});

	it("includes save-article action", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		const saveAction = response.body.actions?.find(
			(a: { name: string }) => a.name === "save-article",
		);
		assert(saveAction, "expected save-article action");
		expect(saveAction.method).toBe("POST");
		expect(saveAction.fields).toEqual([
			{ name: "url", type: "url" },
			{ name: "queues", type: "text", maxItems: READLIST_MAX_PER_USER },
		]);
	});

	it("answers a queue the web page names in its URL with the byte-identical collection a shipped client already reads", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const userId = await loginAndSave(harness, { email: "queue-param@example.com", urlCount: 1 });
		const accessToken = await saveAccessTokenForUser(harness, userId);

		const withoutQueue = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);
		const withQueue = await request(harness.server)
			.get("/queue?queue=default")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(withQueue.status).toBe(200);
		expect(withoutQueue.body.entities).toHaveLength(1);
		expect(withQueue.body).toEqual(withoutQueue.body);
	});
});

describe("POST /queue (Siren save article)", () => {
	it("saves an article and returns Siren entity", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const response = await request(harness.server)
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
		expect(response.body.properties.messages).toEqual([
			{ type: "success", content: { type: "text/html", body: "Article saved" } },
			{ type: "success", content: { type: "text/html", body: "Saved to your reading list" } },
		]);
	});

	it("tells a re-saver the article was already in their queue and moved back to the top", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);
		const saveAgain = () =>
			request(harness.server)
				.post("/queue")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${accessToken}`)
				.set("Content-Type", "application/json")
				.send({ url: "https://example.com/twice" });
		await saveAgain();

		const response = await saveAgain();

		expect(response.status).toBe(201);
		expect(response.body.properties.messages).toEqual([
			{ type: "success", content: { type: "text/html", body: "Already in your readlist" } },
			{ type: "success", content: { type: "text/html", body: "Moved back to the top of your reading list" } },
		]);
	});

	it("claims no queue move when the merged save wrote nothing", async () => {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp({
			...fixture,
			articleStore: {
				...fixture.articleStore,
				saveArticle: async (params) => ({
					...(await fixture.articleStore.saveArticle(params)),
					createdUserArticle: false,
					wroteUserArticle: false,
				}),
			},
		});
		const accessToken = await createAccessToken(harness);

		const response = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/kept-position" });

		expect(response.status).toBe(201);
		expect(response.body.properties.messages).toEqual([
			{ type: "success", content: { type: "text/html", body: "Already in your readlist" } },
		]);
	});

	it("returns 422 for invalid URL", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const response = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "not-a-url" });

		expect(response.status).toBe(422);
		expect(response.body.properties.code).toBe("invalid-url");
	});

	it("returns the article collection for a non-saveable scheme", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/already-saved" });

		const response = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "chrome://newtab/" });

		expect(response.status).toBe(422);
		expect(response.body.class).toEqual(["collection", "articles"]);
		expect(response.body.entities).toHaveLength(1);
		expect(response.body.entities[0].properties.url).toBe(
			"https://example.com/already-saved",
		);
		expect(response.body.properties.warning).toEqual({
			code: "unsupported_scheme",
			message: expect.stringMatching(/http/),
		});
	});

	it("returns the article collection with a private_network warning when the host is local", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const response = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "http://localhost:3000/queue" });

		expect(response.status).toBe(422);
		expect(response.body.class).toEqual(["collection", "articles"]);
		expect(response.body.properties.warning).toEqual({
			code: "private_network",
			message: expect.stringMatching(/[Pp]rivate-network/),
		});
	});

	it("returns the article collection with a private_network warning for a .home.arpa host", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const response = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "http://router.home.arpa/" });

		expect(response.status).toBe(422);
		expect(response.body.properties.warning.code).toBe("private_network");
	});

	it("returns 401 without token", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		expect(response.status).toBe(401);
	});

	it("returns 406 when session-authenticated user POSTs without Siren Accept", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await harness.auth.createUser({ email: "test@example.com", password: "password123" });
		const agent = request.agent(harness.server);
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
		const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
		const applyParseResult = createFakeApplyParseResult({
			articleStore: fixture.articleStore,
			articleCrawl: fixture.articleCrawl,
			parseArticle,
		});
		const harness = useApp({
			...fixture,
			parser: { parseArticle, crawlArticle },
			events: {
				publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
				publishLinkQueued: fixture.events.publishLinkQueued,
				publishLinkDequeued: fixture.events.publishLinkDequeued,
				publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
				publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
				publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
				publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
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
		const accessToken = await createAccessToken(harness);

		const response = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/broken" });

		expect(response.status).toBe(201);
		expect(response.body.properties.title).toBe("Article from example.com");
	});

	it("does not advertise a delete action on a saved article — deletion is website-only", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const response = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		const deleteAction = response.body.actions?.find(
			(a: { name: string }) => a.name === "delete",
		);
		expect(deleteAction).toBeUndefined();
	});

	it("includes update-status action on saved article", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const response = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		const updateStatus = response.body.actions?.find(
			(a: { name: string }) => a.name === "update-status",
		);
		assert(updateStatus, "expected update-status action");
		expect(updateStatus.method).toBe("POST");
		expect(updateStatus.href).toContain("/status");
		expect(updateStatus.type).toBe("application/x-www-form-urlencoded");
		expect(updateStatus.fields).toEqual([
			{ name: "status", type: "text", value: "read" },
		]);
	});
});

describe("GET /queue status tabs (Siren)", () => {
	async function saveAndMarkRead(harness: ReturnType<typeof useApp>, accessToken: string) {
		const saveResponse = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/read-me" });
		const articleId: string = saveResponse.body.properties.id;
		await request(harness.server)
			.post(`/queue/${articleId}/status`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.type("form")
			.send({ status: "read" });
		return articleId;
	}

	it("advertises both tabs with the served one current and a toggle back to unread on each read item", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);
		const articleId = await saveAndMarkRead(harness, accessToken);

		const response = await request(harness.server)
			.get("/queue?status=read")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.body.properties.tabs).toEqual([
			{ label: "To Read", rel: "tab", href: "/queue?status=unread" },
			{ label: "Read", rel: "current", href: "/queue?status=read" },
		]);
		expect(response.body.entities.map((e: { properties: { id: string } }) => e.properties.id)).toEqual([articleId]);
		const updateStatus = response.body.entities[0].actions.find(
			(a: { name: string }) => a.name === "update-status",
		);
		expect(updateStatus).toEqual(
			expect.objectContaining({
				title: "Mark as unread",
				href: `/queue/${articleId}/status?status=read`,
				fields: [{ name: "status", type: "text", value: "unread" }],
			}),
		);
	});

	it("marks the To Read tab current on the default listing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.body.properties.tabs).toEqual([
			{ label: "To Read", rel: "current", href: "/queue?status=unread" },
			{ label: "Read", rel: "tab", href: "/queue?status=read" },
		]);
	});

	it("sends a client that toggles an item from the Read tab back to the Read tab", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);
		await saveAndMarkRead(harness, accessToken);
		const listing = await request(harness.server)
			.get("/queue?status=read")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);
		const updateStatus = listing.body.entities[0].actions.find(
			(a: { name: string }) => a.name === "update-status",
		);
		assert(updateStatus, "expected update-status action on the read item");

		const mutation = await request(harness.server)
			.post(updateStatus.href)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.type("form")
			.send(Object.fromEntries(updateStatus.fields.map((f: { name: string; value: string }) => [f.name, f.value])))
			.redirects(0);

		expect(mutation.status).toBe(303);
		const location = new URL(mutation.headers.location, TEST_APP_ORIGIN);
		expect(parseReadlistUrl(Object.fromEntries(location.searchParams)).tab).toBe("done");

		const landed = await request(harness.server)
			.get(`${location.pathname}${location.search}`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(landed.status).toBe(200);
		expect(landed.body.properties.tabs.find((t: { rel: string }) => t.rel === "current")?.label).toBe("Read");
		expect(landed.body.entities).toEqual([]);
	});
});

describe("POST /queue (Siren re-save read article)", () => {
	it("marks a read article as unread when saved again", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const saveResponse = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/resave-siren" });

		const articleId = saveResponse.body.properties.id;

		await request(harness.server)
			.post(`/queue/${articleId}/status`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ status: "read" });

		const resaveResponse = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/resave-siren" });

		expect(resaveResponse.status).toBe(201);
		expect(resaveResponse.body.properties.status).toBe("unread");

		const listResponse = await request(harness.server)
			.get("/queue?status=unread")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(listResponse.body.entities).toHaveLength(1);
	});
});

describe("POST /queue/:id/delete (Siren)", () => {
	it("redirects to collection via 303 after deleting", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const saveResponse = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		const articleId = saveResponse.body.properties.id;

		const deleteResponse = await request(harness.server)
			.post(`/queue/${articleId}/delete`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Prefer", "return=representation")
			.set("Authorization", `Bearer ${accessToken}`)
			.redirects(0);

		expect(deleteResponse.status).toBe(303);
		expect(deleteResponse.headers.location).toBe("/queue");
	});

	it("returns empty collection after following the redirect", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const saveResponse = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		const articleId = saveResponse.body.properties.id;

		const deleteResponse = await request(harness.server)
			.post(`/queue/${articleId}/delete`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Prefer", "return=representation")
			.set("Authorization", `Bearer ${accessToken}`)
			.redirects(0);

		assert(deleteResponse.headers.location, "expected Location header");
		const collectionResponse = await request(harness.server)
			.get(deleteResponse.headers.location)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(collectionResponse.status).toBe(200);
		expect(collectionResponse.body.class).toContain("collection");
		expect(collectionResponse.body.entities).toEqual([]);
	});
});

describe("extension-alive cookie middleware", () => {
	it("sets the alive cookie as httpOnly on the Siren entry point before login", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.get("/")
			.set("Accept", SIREN_MEDIA_TYPE)
			.redirects(0);

		expect(response.status).toBe(303);
		const setCookie = response.headers["set-cookie"];
		assert(Array.isArray(setCookie), "expected Set-Cookie header");
		const cookie = setCookie.find((c: string) => c.startsWith("hutch_ext_alive="));
		assert(cookie, "expected hutch_ext_alive cookie");
		expect(cookie).toContain("hutch_ext_alive=1");
		expect(cookie).toContain("Path=/");
		expect(cookie).toContain("SameSite=Lax");
		expect(cookie).toContain("Max-Age=");
		// httpOnly is what blocks the extension content script (or any other JS)
		// from forging or renewing this cookie via document.cookie.
		expect(cookie).toContain("HttpOnly");
	});

	it("does not set the alive cookie on browser session requests", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await harness.auth.createUser({ email: "test@example.com", password: "password123" });
		const agent = request.agent(harness.server);
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
		const cookie = cookies.find((c: string) => c.startsWith("hutch_ext_alive="));
		expect(cookie).toBeUndefined();
	});

	it("renews the hutch_ext_saved cookie on a Siren request when it is already present", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.get("/")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Cookie", "hutch_ext_saved=1")
			.redirects(0);

		expect(response.status).toBe(303);
		const setCookie = response.headers["set-cookie"];
		assert(Array.isArray(setCookie), "expected Set-Cookie header");
		const cookie = setCookie.find((c: string) => c.startsWith("hutch_ext_saved="));
		assert(cookie, "expected hutch_ext_saved cookie to be renewed");
		expect(cookie).toContain("hutch_ext_saved=1");
		expect(cookie).toContain("Max-Age=");
		expect(cookie).toContain("HttpOnly");
	});

	it("does not set hutch_ext_saved on a Siren request when the cookie is absent", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.get("/")
			.set("Accept", SIREN_MEDIA_TYPE)
			.redirects(0);

		expect(response.status).toBe(303);
		const setCookie = response.headers["set-cookie"];
		const cookies = Array.isArray(setCookie) ? setCookie : [];
		const cookie = cookies.find((c: string) => c.startsWith("hutch_ext_saved="));
		expect(cookie).toBeUndefined();
	});
});

describe("GET / (Siren entry point)", () => {
	it("redirects Siren clients to /queue", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.get("/")
			.set("Accept", SIREN_MEDIA_TYPE)
			.redirects(0);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
	});

	it("returns home page HTML when Accept is not Siren", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.get("/")
			.set("Accept", "text/html");

		expect(response.status).toBe(200);
		expect(response.type).toContain("text/html");
	});

	/** Firefox extensions send a CORS preflight for fetches with non-simple headers (Accept: application/vnd.siren+json, Authorization). Without an OPTIONS handler here the preflight 404s and firefox aborts the fetch with NetworkError. */
	it("handles CORS preflight from extension origin", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
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

	it("lets a Siren client hold the redirect for the server-defined lifetime, keyed on Accept", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server)
			.get("/")
			.set("Accept", SIREN_MEDIA_TYPE)
			.redirects(0);

		expect(response.status).toBe(303);
		expect(response.headers["cache-control"]).toBe(
			`private, max-age=${SIREN_DISCOVERY_MAX_AGE_SECONDS}`,
		);
		expect(response.headers.vary).toBe("Accept, Origin");
	});

	it("caches the redirect for the iOS app the same way", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const response = await request(harness.server)
			.get("/")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set(NATIVE_CLIENT_HEADER, "ios")
			.redirects(0);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
		expect(response.headers["cache-control"]).toBe(
			`private, max-age=${SIREN_DISCOVERY_MAX_AGE_SECONDS}`,
		);
		expect(response.headers.vary).toBe("Accept, Origin");
	});

	it("caches the redirect a cookie-session Siren client follows too", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent
			.get("/")
			.set("Accept", SIREN_MEDIA_TYPE)
			.redirects(0);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
		expect(response.headers["cache-control"]).toBe(
			`private, max-age=${SIREN_DISCOVERY_MAX_AGE_SECONDS}`,
		);
	});

	it("keeps the signed-in browser's redirect out of every cache", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/").set("Accept", "text/html").redirects(0);

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/queue");
		expect(response.headers["cache-control"]).toBeUndefined();
	});

	it("keeps the home page per-visitor, since the A/B arm rides a cookie", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));

		const response = await request(harness.server).get("/").set("Accept", "text/html");

		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toBe("private, no-cache");
	});
});

describe("GET /queue?url= (Siren URL filter)", () => {
	it("returns matching article when URL filter matches", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article-1" });

		await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article-2" });

		const response = await request(harness.server)
			.get("/queue?url=https://example.com/article-1")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.body.entities).toHaveLength(1);
		expect(response.body.entities[0].properties.url).toBe("https://example.com/article-1");
	});

	it("returns empty collection when URL filter has no match", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		const response = await request(harness.server)
			.get("/queue?url=https://example.com/nonexistent")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.body.entities).toHaveLength(0);
	});
});

describe("Article sub-entity actions", () => {
	it("does not advertise a delete action on article sub-entities in collection — deletion is website-only", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		const entity = response.body.entities[0];
		const deleteAction = entity.actions?.find(
			(a: { name: string }) => a.name === "delete",
		);
		expect(deleteAction).toBeUndefined();
	});

	it("includes update-status action on article sub-entities in collection", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "https://example.com/article" });

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		const entity = response.body.entities[0];
		const updateStatus = entity.actions?.find(
			(a: { name: string }) => a.name === "update-status",
		);
		assert(updateStatus, "expected update-status action on sub-entity");
		expect(updateStatus.method).toBe("POST");
		expect(updateStatus.href).toContain("/status");
		expect(updateStatus.type).toBe("application/x-www-form-urlencoded");
		expect(updateStatus.fields).toEqual([
			{ name: "status", type: "text", value: "read" },
		]);
	});
});

describe("needsBrowserCapture on the Siren collection", () => {
	const BLOCKED_URL = "https://example.com/edge-blocked";
	const READY_URL = "https://example.com/readable";

	async function seedBlockedAndReadyRows() {
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const parseArticle: typeof fixture.parser.parseArticle = async (url) =>
			url === BLOCKED_URL
				? { ok: false, reason: JSON.stringify({ kind: "blocked", cause: "edge-block" }) }
				: fixture.parser.parseArticle(url);
		const applyParseResult = createFakeApplyParseResult({
			articleStore: fixture.articleStore,
			articleCrawl: fixture.articleCrawl,
			parseArticle,
		});
		const harness = useApp({
			...fixture,
			parser: { parseArticle, crawlArticle: fixture.parser.crawlArticle },
			events: {
				...fixture.events,
				publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
			},
		});
		const accessToken = await createAccessToken(harness);

		for (const url of [BLOCKED_URL, READY_URL]) {
			await request(harness.server)
				.post("/queue")
				.set("Accept", SIREN_MEDIA_TYPE)
				.set("Authorization", `Bearer ${accessToken}`)
				.set("Content-Type", "application/json")
				.send({ url });
		}

		return { harness, accessToken };
	}

	function captureFlagByUrl(
		entities: Array<{ properties: { url: string; needsBrowserCapture: unknown } }>,
	): Record<string, unknown> {
		return Object.fromEntries(
			entities.map((entity) => [
				entity.properties.url,
				entity.properties.needsBrowserCapture,
			]),
		);
	}

	it("flags the edge-blocked row and only that row, so a client offers the capture on the article that needs it", async () => {
		const { harness, accessToken } = await seedBlockedAndReadyRows();

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(captureFlagByUrl(response.body.entities)).toEqual({
			[BLOCKED_URL]: true,
			[READY_URL]: false,
		});
	});

	it("carries the same flags on the 422 collection a rejected save returns, so re-rendering the list keeps the affordance", async () => {
		const { harness, accessToken } = await seedBlockedAndReadyRows();

		const response = await request(harness.server)
			.post("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.set("Content-Type", "application/json")
			.send({ url: "chrome://newtab/" });

		expect(response.status).toBe(422);
		expect(captureFlagByUrl(response.body.entities)).toEqual({
			[BLOCKED_URL]: true,
			[READY_URL]: false,
		});
	});
});

describe("Content negotiation", () => {
	it("returns HTML when Accept header is text/html", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await harness.auth.createUser({ email: "test@example.com", password: "password123" });
		const agent = request.agent(harness.server);
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
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		await harness.auth.createUser({ email: "test@example.com", password: "password123" });
		const agent = request.agent(harness.server);
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
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const accessToken = await createAccessToken(harness);

		const response = await request(harness.server)
			.get("/queue")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`);

		expect(response.status).toBe(200);
		expect(response.type).toContain("application/vnd.siren+json");
	});
});

describe("Siren readlists", () => {
	const WORK_LABEL = "Work";
	const RECIPES_LABEL = "Recipes";
	const SEED_METADATA = { title: "Seeded", siteName: "example.com", excerpt: "", wordCount: 0 };

	async function readerWithReadlist(
		harness: ReturnType<typeof useApp>,
		params: { email: string; label: string },
	) {
		await harness.auth.createUser({ email: params.email, password: "password123" });
		const agent = request.agent(harness.server);
		await agent.post("/login").type("form").send({ email: params.email, password: "password123" });
		const loginResult = await harness.auth.verifyCredentials({
			email: params.email,
			password: "password123",
		});
		assert(loginResult.ok);
		const userId = loginResult.userId;
		const readlist = ReadlistSlugSchema.parse("work");
		await harness.articleStore.createReadlistDefinition({
			userId,
			slug: readlist,
			label: params.label,
			createdAt: new Date("2026-03-04T10:00:00.000Z"),
		});
		return {
			agent,
			userId,
			readlist,
			accessToken: await saveAccessTokenForUser(harness, userId),
		};
	}

	function readCollection(
		harness: ReturnType<typeof useApp>,
		params: { accessToken: string; path: string },
	) {
		return request(harness.server)
			.get(params.path)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${params.accessToken}`);
	}

	function saveThrough(
		harness: ReturnType<typeof useApp>,
		params: { accessToken: string; path: string; url: string; queues?: string[] },
	) {
		return request(harness.server)
			.post(params.path)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${params.accessToken}`)
			.set("Content-Type", "application/json")
			.send(params.queues ? { url: params.url, queues: params.queues } : { url: params.url });
	}

	async function advertisedReadlistHrefs(
		harness: ReturnType<typeof useApp>,
		params: { accessToken: string },
	): Promise<Record<string, string>> {
		const collection = await readCollection(harness, {
			accessToken: params.accessToken,
			path: "/queue",
		});
		return Object.fromEntries(
			collection.body.properties.readlists.map((entry: { label: string; href: string }) => [
				entry.label,
				entry.href,
			]),
		);
	}

	async function readerWithTwoReadlists(
		harness: ReturnType<typeof useApp>,
		params: { email: string },
	) {
		const reader = await readerWithReadlist(harness, { email: params.email, label: WORK_LABEL });
		const recipes = ReadlistSlugSchema.parse("recipes");
		await harness.articleStore.createReadlistDefinition({
			userId: reader.userId,
			slug: recipes,
			label: RECIPES_LABEL,
			createdAt: new Date("2026-03-04T11:00:00.000Z"),
		});
		return { ...reader, recipes, hrefs: await advertisedReadlistHrefs(harness, reader) };
	}

	function articleUrls(body: { entities?: { properties: { url: string } }[] }): string[] {
		return (body.entities ?? []).map((entity) => entity.properties.url);
	}

	function messageBodies(body: { properties: { messages: { content: { body: string } }[] } }): string[] {
		return body.properties.messages.map((message) => message.content.body);
	}

	it("advertises every readlist the reader owns on the default listing, with the mainline current", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { readlist, accessToken } = await readerWithReadlist(harness, {
			email: "readlists-listing@example.com",
			label: WORK_LABEL,
		});

		const response = await readCollection(harness, { accessToken, path: "/queue" });

		expect(response.body.properties.readlists).toEqual([
			{ label: "All", rel: "current", href: "/queue" },
			{ label: WORK_LABEL, rel: "readlist", href: `/queue?queue=${readlist}` },
		]);
	});

	it("lists only the addressed readlist's saves and carries it on every href the collection builds", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { userId, readlist, accessToken } = await readerWithReadlist(harness, {
			email: "readlists-scoped@example.com",
			label: WORK_LABEL,
		});
		await saveThrough(harness, { accessToken, path: "/queue", url: "https://example.com/in-all" });
		await harness.articleStore.saveReadlistArticle({
			userId,
			readlist,
			url: "https://example.com/in-work",
			metadata: SEED_METADATA,
			estimatedReadTime: MinutesSchema.parse(0),
			provenance: { kind: "web" },
			savedAt: new Date("2026-03-05T10:00:00.000Z"),
		});

		const response = await readCollection(harness, {
			accessToken,
			path: `/queue?queue=${readlist}`,
		});
		const article = response.body.entities[0];

		expect({
			urls: articleUrls(response.body),
			readlists: response.body.properties.readlists,
			self: response.body.links.find((link: { rel: string[] }) => link.rel.includes("self")).href,
			tabs: response.body.properties.tabs.map((tab: { href: string }) => tab.href),
			read: article.links.find((link: { rel: string[] }) => link.rel.includes("read")).href,
			updateStatus: article.actions.find((action: { name: string }) => action.name === "update-status")
				.href,
			saveArticle: response.body.actions.find(
				(action: { name: string }) => action.name === "save-article",
			).href,
		}).toEqual({
			urls: ["https://example.com/in-work"],
			readlists: [
				{ label: "All", rel: "readlist", href: "/queue" },
				{ label: WORK_LABEL, rel: "current", href: `/queue?queue=${readlist}` },
			],
			self: `/queue?queue=${readlist}&status=unread&page=1`,
			tabs: [`/queue?queue=${readlist}&status=unread`, `/queue?queue=${readlist}&status=read`],
			read: `/queue/${article.properties.id}/view?queue=${readlist}`,
			updateStatus: `/queue/${article.properties.id}/status?queue=${readlist}&status=unread`,
			saveArticle: `/queue?queue=${readlist}`,
		});
	});

	it("answers a readlist the reader does not own with the byte-identical mainline collection", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { accessToken } = await readerWithReadlist(harness, {
			email: "readlists-unowned@example.com",
			label: WORK_LABEL,
		});
		await saveThrough(harness, { accessToken, path: "/queue", url: "https://example.com/in-all" });

		const mainline = await readCollection(harness, { accessToken, path: "/queue" });
		const unowned = await readCollection(harness, { accessToken, path: "/queue?queue=nobodys" });

		expect(unowned.status).toBe(200);
		expect(unowned.body).toEqual(mainline.body);
	});

	it("sends a client that toggles an item inside a readlist back to that readlist's Read tab", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { readlist, accessToken } = await readerWithReadlist(harness, {
			email: "readlists-toggle@example.com",
			label: WORK_LABEL,
		});
		const saved = await saveThrough(harness, {
			accessToken,
			path: `/queue?queue=${readlist}`,
			url: "https://example.com/toggle-in-work",
		});
		await request(harness.server)
			.post(`/queue/${saved.body.properties.id}/status?queue=${readlist}`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.type("form")
			.send({ status: "read" });
		const onRead = await readCollection(harness, {
			accessToken,
			path: `/queue?queue=${readlist}&status=read`,
		});
		const updateStatus = onRead.body.entities[0].actions.find(
			(action: { name: string }) => action.name === "update-status",
		);

		const mutation = await request(harness.server)
			.post(updateStatus.href)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.type("form")
			.send(
				Object.fromEntries(
					updateStatus.fields.map((field: { name: string; value: string }) => [
						field.name,
						field.value,
					]),
				),
			)
			.redirects(0);

		expect(mutation.status).toBe(303);
		const location = new URL(mutation.headers.location, TEST_APP_ORIGIN);
		expect(parseReadlistUrl(Object.fromEntries(location.searchParams))).toEqual({
			readlist,
			tab: "done",
			order: undefined,
			page: 1,
		});
	});

	it("opens the owner reader through the read link of an article that lives only in a readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { agent, userId, readlist, accessToken } = await readerWithReadlist(harness, {
			email: "readlists-reader@example.com",
			label: WORK_LABEL,
		});
		await harness.articleStore.saveReadlistArticle({
			userId,
			readlist,
			url: "https://example.com/only-in-work",
			metadata: SEED_METADATA,
			estimatedReadTime: MinutesSchema.parse(0),
			provenance: { kind: "web" },
			savedAt: new Date("2026-03-05T10:00:00.000Z"),
		});
		const collection = await readCollection(harness, {
			accessToken,
			path: `/queue?queue=${readlist}`,
		});
		const readHref = collection.body.entities[0].links.find((link: { rel: string[] }) =>
			link.rel.includes("read"),
		).href;

		const reader = await agent.get(readHref);

		expect(reader.status).toBe(200);
	});

	it("files a save through a readlist's collection into that readlist and names it in the confirmation", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { readlist, accessToken } = await readerWithReadlist(harness, {
			email: "readlists-save@example.com",
			label: WORK_LABEL,
		});

		const saved = await saveThrough(harness, {
			accessToken,
			path: `/queue?queue=${readlist}`,
			url: "https://example.com/filed-into-work",
		});

		expect(saved.status).toBe(201);
		expect(messageBodies(saved.body)).toEqual(["Article saved", "Saved to 'Work'"]);
		expect(
			saved.body.links.find((link: { rel: string[] }) => link.rel.includes("collection")).href,
		).toBe(`/queue?queue=${readlist}`);
		const inAll = await readCollection(harness, { accessToken, path: "/queue" });
		const inWork = await readCollection(harness, {
			accessToken,
			path: `/queue?queue=${readlist}`,
		});
		expect([articleUrls(inAll.body), articleUrls(inWork.body)]).toEqual([
			["https://example.com/filed-into-work"],
			["https://example.com/filed-into-work"],
		]);
	});

	it("names the mainline readlist when a reader who owns several saves through the bare collection", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { readlist, accessToken } = await readerWithReadlist(harness, {
			email: "readlists-save-all@example.com",
			label: WORK_LABEL,
		});

		const saved = await saveThrough(harness, {
			accessToken,
			path: "/queue",
			url: "https://example.com/filed-into-all",
		});

		expect(messageBodies(saved.body)).toEqual(["Article saved", "Saved to 'All'"]);
		const inWork = await readCollection(harness, {
			accessToken,
			path: `/queue?queue=${readlist}`,
		});
		expect(articleUrls(inWork.body)).toEqual([]);
	});

	it("files into the mainline readlist when the save names one the reader does not own", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { accessToken } = await readerWithReadlist(harness, {
			email: "readlists-save-unowned@example.com",
			label: WORK_LABEL,
		});

		const saved = await saveThrough(harness, {
			accessToken,
			path: "/queue?queue=nobodys",
			url: "https://example.com/filed-nowhere",
		});

		expect(messageBodies(saved.body)).toEqual(["Article saved", "Saved to 'All'"]);
		expect(
			saved.body.links.find((link: { rel: string[] }) => link.rel.includes("collection")).href,
		).toBe("/queue");
	});

	it("treats a URL already in the mainline as a fresh save when a readlist's collection addresses it", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { readlist, accessToken } = await readerWithReadlist(harness, {
			email: "readlists-save-again-elsewhere@example.com",
			label: WORK_LABEL,
		});
		await saveThrough(harness, { accessToken, path: "/queue", url: "https://example.com/both" });

		const saved = await saveThrough(harness, {
			accessToken,
			path: `/queue?queue=${readlist}`,
			url: "https://example.com/both",
		});

		expect(messageBodies(saved.body)).toEqual(["Article saved", "Saved to 'Work'"]);
	});

	it("answers a re-save inside a readlist with the moved-back copy and puts the row first in that readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { readlist, accessToken } = await readerWithReadlist(harness, {
			email: "readlists-resave@example.com",
			label: WORK_LABEL,
		});
		const intoWork = { accessToken, path: `/queue?queue=${readlist}` };
		await saveThrough(harness, { ...intoWork, url: "https://example.com/first" });
		await saveThrough(harness, { ...intoWork, url: "https://example.com/second" });

		const resaved = await saveThrough(harness, { ...intoWork, url: "https://example.com/first" });

		expect(messageBodies(resaved.body)).toEqual([
			"Already in your readlist",
			"Moved back to the top of your reading list",
		]);
		const inWork = await readCollection(harness, {
			accessToken,
			path: `/queue?queue=${readlist}`,
		});
		expect(articleUrls(inWork.body)).toEqual([
			"https://example.com/first",
			"https://example.com/second",
		]);
	});

	it("clears the read status inside the addressed readlist when a read article is saved there again", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { readlist, accessToken } = await readerWithReadlist(harness, {
			email: "readlists-resave-read@example.com",
			label: WORK_LABEL,
		});
		const intoWork = { accessToken, path: `/queue?queue=${readlist}` };
		const saved = await saveThrough(harness, { ...intoWork, url: "https://example.com/read-again" });
		await request(harness.server)
			.post(`/queue/${saved.body.properties.id}/status?queue=${readlist}`)
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${accessToken}`)
			.type("form")
			.send({ status: "read" });

		await saveThrough(harness, { ...intoWork, url: "https://example.com/read-again" });

		const unread = await readCollection(harness, {
			accessToken,
			path: `/queue?queue=${readlist}&status=unread`,
		});
		expect(articleUrls(unread.body)).toEqual(["https://example.com/read-again"]);
	});

	it("files a save into every readlist the client ticked and names them all", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { readlist, recipes, accessToken, hrefs } = await readerWithTwoReadlists(harness, {
			email: "readlists-save-many@example.com",
		});

		const saved = await saveThrough(harness, {
			accessToken,
			path: "/queue",
			url: "https://example.com/filed-into-both",
			queues: [hrefs[WORK_LABEL], hrefs[RECIPES_LABEL]],
		});

		expect(messageBodies(saved.body)).toEqual(["Article saved", "Saved to 'Work' and 'Recipes'"]);
		expect(
			saved.body.links.find((link: { rel: string[] }) => link.rel.includes("collection")).href,
		).toBe(`/queue?queue=${readlist}`);
		const inWork = await readCollection(harness, {
			accessToken,
			path: `/queue?queue=${readlist}`,
		});
		const inRecipes = await readCollection(harness, {
			accessToken,
			path: `/queue?queue=${recipes}`,
		});
		expect([articleUrls(inWork.body), articleUrls(inRecipes.body)]).toEqual([
			["https://example.com/filed-into-both"],
			["https://example.com/filed-into-both"],
		]);
	});

	it("leaves the reader's other readlists alone when the save names no queues", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { readlist, recipes, accessToken } = await readerWithTwoReadlists(harness, {
			email: "readlists-save-none-ticked@example.com",
		});

		const saved = await saveThrough(harness, {
			accessToken,
			path: `/queue?queue=${readlist}`,
			url: "https://example.com/only-where-addressed",
		});

		expect(messageBodies(saved.body)).toEqual(["Article saved", "Saved to 'Work'"]);
		const inWork = await readCollection(harness, {
			accessToken,
			path: `/queue?queue=${readlist}`,
		});
		const inRecipes = await readCollection(harness, {
			accessToken,
			path: `/queue?queue=${recipes}`,
		});
		expect([articleUrls(inWork.body), articleUrls(inRecipes.body)]).toEqual([
			["https://example.com/only-where-addressed"],
			[],
		]);
	});

	it("ignores a ticked queue the reader does not own", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { readlist, accessToken } = await readerWithReadlist(harness, {
			email: "readlists-save-ticked-unowned@example.com",
			label: WORK_LABEL,
		});

		const saved = await saveThrough(harness, {
			accessToken,
			path: `/queue?queue=${readlist}`,
			url: "https://example.com/one-owned-queue",
			queues: ["/queue?queue=nobodys"],
		});

		expect(messageBodies(saved.body)).toEqual(["Article saved", "Saved to 'Work'"]);
		const inWork = await readCollection(harness, {
			accessToken,
			path: `/queue?queue=${readlist}`,
		});
		expect(articleUrls(inWork.body)).toEqual(["https://example.com/one-owned-queue"]);
	});

	it("ignores the mainline readlist's own href, which every save already lands in", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { readlist, accessToken, hrefs } = await readerWithTwoReadlists(harness, {
			email: "readlists-save-ticked-mainline@example.com",
		});

		const saved = await saveThrough(harness, {
			accessToken,
			path: `/queue?queue=${readlist}`,
			url: "https://example.com/mainline-ticked",
			queues: [hrefs.All],
		});

		expect(messageBodies(saved.body)).toEqual(["Article saved", "Saved to 'Work'"]);
		const inAll = await readCollection(harness, { accessToken, path: "/queue" });
		expect(articleUrls(inAll.body)).toEqual(["https://example.com/mainline-ticked"]);
	});

	it("files one copy when the client ticks the readlist the save already addresses", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { readlist, accessToken, hrefs } = await readerWithTwoReadlists(harness, {
			email: "readlists-save-ticked-twice@example.com",
		});

		const saved = await saveThrough(harness, {
			accessToken,
			path: `/queue?queue=${readlist}`,
			url: "https://example.com/ticked-twice",
			queues: [hrefs[WORK_LABEL], hrefs[WORK_LABEL]],
		});

		expect(messageBodies(saved.body)).toEqual(["Article saved", "Saved to 'Work'"]);
		const inWork = await readCollection(harness, {
			accessToken,
			path: `/queue?queue=${readlist}`,
		});
		expect(articleUrls(inWork.body)).toEqual(["https://example.com/ticked-twice"]);
	});

	it("announces a fresh save when a link the reader already holds is ticked into a readlist it was missing from", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { recipes, accessToken, hrefs } = await readerWithTwoReadlists(harness, {
			email: "readlists-save-into-new-queue@example.com",
		});
		await saveThrough(harness, {
			accessToken,
			path: "/queue",
			url: "https://example.com/already-held",
		});

		const saved = await saveThrough(harness, {
			accessToken,
			path: "/queue",
			url: "https://example.com/already-held",
			queues: [hrefs[RECIPES_LABEL]],
		});

		expect(messageBodies(saved.body)).toEqual(["Article saved", "Saved to 'Recipes'"]);
		const inRecipes = await readCollection(harness, {
			accessToken,
			path: `/queue?queue=${recipes}`,
		});
		expect(articleUrls(inRecipes.body)).toEqual(["https://example.com/already-held"]);
	});

	it("tells a re-saver nothing new was filed when the link already sits in every ticked readlist", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const { accessToken, hrefs } = await readerWithTwoReadlists(harness, {
			email: "readlists-save-ticked-again@example.com",
		});
		const intoBoth = {
			accessToken,
			path: "/queue",
			url: "https://example.com/held-in-both",
			queues: [hrefs[WORK_LABEL], hrefs[RECIPES_LABEL]],
		};
		await saveThrough(harness, intoBoth);

		const resaved = await saveThrough(harness, intoBoth);

		expect(messageBodies(resaved.body)).toEqual([
			"Already in your readlist",
			"Moved back to the top of your reading list",
		]);
	});
});
