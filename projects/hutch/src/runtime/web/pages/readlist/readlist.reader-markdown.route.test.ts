import assert from "node:assert/strict";
import matter from "gray-matter";
import request from "supertest";
import { MinutesSchema, ReaderArticleHashId } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeSummaryProvider,
} from "@packages/test-fixtures";
import { loginAgent, useTestServer } from "../../../test-app";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { createAccessToken, saveAccessTokenForUser } from "../../test-helpers/oauth-token";

const useApp = useTestServer();

type Harness = ReturnType<typeof useApp>;

function buildHarness() {
	const summary = createFakeSummaryProvider();
	const harness = useApp({ ...createDefaultTestAppFixture(TEST_APP_ORIGIN), summary });
	return { harness, summary };
}

function sirenGet(harness: Harness, params: { path: string; token: string }) {
	return request(harness.server)
		.get(params.path)
		.set("Accept", SIREN_MEDIA_TYPE)
		.set("Authorization", `Bearer ${params.token}`);
}

function markdownGet(harness: Harness, params: { path: string; token: string }) {
	return request(harness.server)
		.get(params.path)
		.set("Accept", "text/markdown")
		.set("Authorization", `Bearer ${params.token}`);
}

function firstReadHref(collection: request.Response): string {
	const link = collection.body.entities[0].links.find((candidate: { rel: string[] }) =>
		candidate.rel.includes("read"),
	);
	assert(link, "the first article entity must carry a read link");
	return link.href;
}

async function loggedInOwner(harness: Harness) {
	const agent = await loginAgent(harness.server, harness.auth);
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the logged-in user must exist");
	return { agent, userId: user.userId, token: await saveAccessTokenForUser(harness, user.userId) };
}

describe("Owner reader Markdown (GET /queue/:id/view with Accept: text/markdown)", () => {
	it("serves the owner's Markdown to a bearer client that finds the read link from the entry point", async () => {
		const { harness, summary } = buildHarness();
		const url = "https://example.com/post";
		const id = ReaderArticleHashId.from(url).value;
		await harness.articleStore.saveArticle({
			userId: UserIdSchema.parse("test-user-123"),
			url,
			metadata: { title: "Hello World", siteName: "example.com", excerpt: "Parsed blurb.", wordCount: 3 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-09-30T01:02:03.000Z"),
		});
		await harness.articleStore.writeContent({ url, content: "<p>Body copy.</p>" });
		await harness.articleCrawl.markCrawlReady({ url });
		summary.markSummaryReady({
			url,
			summary: "First point.\n\nSecond point.",
			excerpt: "Generated blurb.",
			topics: [],
		});
		const token = await createAccessToken(harness);

		const entry = await request(harness.server)
			.get("/")
			.set("Accept", SIREN_MEDIA_TYPE)
			.set("Authorization", `Bearer ${token}`)
			.redirects(0);
		const collection = await sirenGet(harness, { path: entry.headers.location, token });
		const readHref = firstReadHref(collection);
		const response = await markdownGet(harness, { path: readHref, token });

		expect(entry.status).toBe(303);
		expect(readHref).toBe(`/queue/${id}/view`);
		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(response.headers["cache-control"]).toBe("private, no-cache");
		expect(response.headers["x-robots-tag"]).toBe("noindex");
		expect(response.headers["content-signal"]).toBe("search=no, ai-input=no, ai-train=no");
		const document = matter(response.text);
		expect(document.data).toEqual({
			title: "Hello World",
			source: url,
			site: "example.com",
			description: "Generated blurb.",
			created: "2026-09-30T01:02:03.000Z",
			words: 3,
			readplace_id: id,
			readplace_url: `${TEST_APP_ORIGIN}/queue/${id}/view`,
			readplace_status: "unread",
			readplace_read_time: 1,
			readplace_readlists: ["All"],
			readplace_content_status: "ready",
			readplace_summary_status: "ready",
			readplace_summary: "First point.\n\nSecond point.",
		});
		expect(document.content).toBe(
			[
				"",
				"> [!summary] Summary (TL;DR)",
				"> First point.",
				">",
				"> Second point.",
				"",
				"Body copy.",
				"",
			].join("\n"),
		);
	});

	it("serves the same document to the owner's session cookie as to the owner's bearer token", async () => {
		const { harness, summary } = buildHarness();
		const { agent, userId, token } = await loggedInOwner(harness);
		const url = "https://example.com/post";
		const id = ReaderArticleHashId.from(url).value;
		await harness.articleStore.saveArticle({
			userId,
			url,
			metadata: { title: "Hello World", siteName: "example.com", excerpt: "Parsed blurb.", wordCount: 3 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-09-30T01:02:03.000Z"),
		});
		await harness.articleStore.writeContent({ url, content: "<p>Body copy.</p>" });
		await harness.articleCrawl.markCrawlReady({ url });
		summary.markSummaryReady({
			url,
			summary: "First point.\n\nSecond point.",
			excerpt: "Generated blurb.",
			topics: [],
		});

		const cookieResponse = await agent.get(`/queue/${id}/view`).set("Accept", "text/markdown");
		const bearerResponse = await markdownGet(harness, { path: `/queue/${id}/view`, token });

		expect(cookieResponse.status).toBe(200);
		expect(cookieResponse.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(matter(cookieResponse.text).data).toEqual({
			title: "Hello World",
			source: url,
			site: "example.com",
			description: "Generated blurb.",
			created: "2026-09-30T01:02:03.000Z",
			words: 3,
			readplace_id: id,
			readplace_url: `${TEST_APP_ORIGIN}/queue/${id}/view`,
			readplace_status: "unread",
			readplace_read_time: 1,
			readplace_readlists: ["All"],
			readplace_content_status: "ready",
			readplace_summary_status: "ready",
			readplace_summary: "First point.\n\nSecond point.",
		});
		expect(cookieResponse.text).toBe(bearerResponse.text);
	});

	it("lets the bearer token win over a session cookie that belongs to another account", async () => {
		const { harness } = buildHarness();
		const { agent } = await loggedInOwner(harness);
		const url = "https://example.com/post";
		const id = ReaderArticleHashId.from(url).value;
		await harness.articleStore.saveArticle({
			userId: UserIdSchema.parse("test-user-123"),
			url,
			metadata: { title: "Hello World", siteName: "example.com", excerpt: "Parsed blurb.", wordCount: 3 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-09-30T01:02:03.000Z"),
		});
		const token = await createAccessToken(harness);

		const response = await agent
			.get(`/queue/${id}/view`)
			.set("Accept", "text/markdown")
			.set("Authorization", `Bearer ${token}`);

		expect(response.status).toBe(200);
		expect(matter(response.text).data.readplace_id).toBe(id);
	});

	it("answers an invalid bearer token with a Markdown 401 that tells the client to refresh", async () => {
		const { harness } = buildHarness();
		const url = "https://example.com/post";
		const id = ReaderArticleHashId.from(url).value;
		await harness.articleStore.saveArticle({
			userId: UserIdSchema.parse("test-user-123"),
			url,
			metadata: { title: "Hello World", siteName: "example.com", excerpt: "Parsed blurb.", wordCount: 3 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-09-30T01:02:03.000Z"),
		});

		const response = await markdownGet(harness, { path: `/queue/${id}/view`, token: "invalid-token" });

		expect(response.status).toBe(401);
		expect(response.headers["www-authenticate"]).toBe('Bearer error="invalid_token"');
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(response.headers["cache-control"]).toBe("private, no-cache");
		expect(response.text).toBe("# Unauthorized\n");
	});

	it("answers a valid bearer token for another user's article with a Markdown 404", async () => {
		const { harness } = buildHarness();
		const url = "https://example.com/post";
		const id = ReaderArticleHashId.from(url).value;
		await harness.articleStore.saveArticle({
			userId: UserIdSchema.parse("another-user-456"),
			url,
			metadata: { title: "Hello World", siteName: "example.com", excerpt: "Parsed blurb.", wordCount: 3 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-09-30T01:02:03.000Z"),
		});
		const token = await createAccessToken(harness);

		const response = await markdownGet(harness, { path: `/queue/${id}/view`, token });

		expect(response.status).toBe(404);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(response.headers["cache-control"]).toBe("private, no-cache");
		expect(response.text).toBe("# Not found\n");
	});

	it("answers a valid bearer token with a malformed article id with the same Markdown 404", async () => {
		const { harness } = buildHarness();
		const token = await createAccessToken(harness);

		const response = await markdownGet(harness, { path: "/queue/not-a-hash/view", token });

		expect(response.status).toBe(404);
		expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
		expect(response.headers["cache-control"]).toBe("private, no-cache");
		expect(response.text).toBe("# Not found\n");
	});

	it("keeps redirecting an anonymous Markdown request to the public reader", async () => {
		const { harness } = buildHarness();
		const url = "https://example.com/post";
		const id = ReaderArticleHashId.from(url).value;
		await harness.articleStore.saveArticle({
			userId: UserIdSchema.parse("test-user-123"),
			url,
			metadata: { title: "Hello World", siteName: "example.com", excerpt: "Parsed blurb.", wordCount: 3 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-09-30T01:02:03.000Z"),
		});

		const response = await request(harness.server)
			.get(`/queue/${id}/view`)
			.set("Accept", "text/markdown");

		expect(response.status).toBe(302);
		expect(new URL(response.headers.location, TEST_APP_ORIGIN).pathname).toBe("/view/example.com/post");
	});

	it("keeps redirecting another signed-in account's Markdown request to the public reader", async () => {
		const { harness } = buildHarness();
		const url = "https://example.com/post";
		const id = ReaderArticleHashId.from(url).value;
		await harness.articleStore.saveArticle({
			userId: UserIdSchema.parse("test-user-123"),
			url,
			metadata: { title: "Hello World", siteName: "example.com", excerpt: "Parsed blurb.", wordCount: 3 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-09-30T01:02:03.000Z"),
		});
		await harness.auth.createUser({ email: "guest@example.com", password: "password123" });
		const guestAgent = request.agent(harness.server);
		await guestAgent
			.post("/login")
			.type("form")
			.send({ email: "guest@example.com", password: "password123" });

		const response = await guestAgent.get(`/queue/${id}/view`).set("Accept", "text/markdown");

		expect(response.status).toBe(302);
		expect(new URL(response.headers.location, TEST_APP_ORIGIN).pathname).toBe("/view/example.com/post");
	});

	it("treats a non-Bearer Authorization scheme like no credentials at all", async () => {
		const { harness } = buildHarness();
		const url = "https://example.com/post";
		const id = ReaderArticleHashId.from(url).value;
		await harness.articleStore.saveArticle({
			userId: UserIdSchema.parse("test-user-123"),
			url,
			metadata: { title: "Hello World", siteName: "example.com", excerpt: "Parsed blurb.", wordCount: 3 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-09-30T01:02:03.000Z"),
		});

		const response = await request(harness.server)
			.get(`/queue/${id}/view`)
			.set("Accept", "text/markdown")
			.set("Authorization", "Basic dXNlcjpwYXNz");

		expect(response.status).toBe(302);
		expect(new URL(response.headers.location, TEST_APP_ORIGIN).pathname).toBe("/view/example.com/post");
	});

	it("does not stamp viewedAt when the owner fetches the Markdown", async () => {
		const { harness } = buildHarness();
		const { agent, userId } = await loggedInOwner(harness);
		const url = "https://example.com/post";
		const id = ReaderArticleHashId.from(url).value;
		await harness.articleStore.saveArticle({
			userId,
			url,
			metadata: { title: "Hello World", siteName: "example.com", excerpt: "Parsed blurb.", wordCount: 3 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-09-30T01:02:03.000Z"),
		});

		const response = await agent.get(`/queue/${id}/view`).set("Accept", "text/markdown");

		expect(response.status).toBe(200);
		expect(await harness.articleStore.findUserArticlesByUrl(url)).toEqual([{ userId, viewedAt: undefined }]);
	});

	it("serves identical bytes through the read href of every readlist that holds the article", async () => {
		const { harness } = buildHarness();
		const userId = UserIdSchema.parse("test-user-123");
		const url = "https://example.com/post";
		const id = ReaderArticleHashId.from(url);
		const work = ReadlistSlugSchema.parse("work");
		await harness.articleStore.saveArticle({
			userId,
			url,
			metadata: { title: "Hello World", siteName: "example.com", excerpt: "Parsed blurb.", wordCount: 3 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-09-30T01:02:03.000Z"),
		});
		await harness.articleStore.createReadlistDefinition({
			userId,
			slug: work,
			label: "Work",
			createdAt: new Date("2026-09-30T02:00:00.000Z"),
		});
		await harness.articleStore.saveReadlistArticle({
			userId,
			readlist: work,
			url,
			metadata: { title: "Hello World", siteName: "example.com", excerpt: "Parsed blurb.", wordCount: 3 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-10-01T05:06:07.000Z"),
		});
		await harness.articleStore.setReadlistArticleStatus({
			id,
			userId,
			readlist: work,
			status: "read",
		});
		await harness.articleStore.writeContent({ url, content: "<p>Body copy.</p>" });
		await harness.articleCrawl.markCrawlReady({ url });
		const token = await createAccessToken(harness);

		const allCollection = await sirenGet(harness, { path: "/queue", token });
		const workCollection = await sirenGet(harness, { path: "/queue?queue=work&status=read", token });
		const allHref = firstReadHref(allCollection);
		const workHref = firstReadHref(workCollection);
		const viaAll = await markdownGet(harness, { path: allHref, token });
		const viaWork = await markdownGet(harness, { path: workHref, token });

		expect(allHref).toBe(`/queue/${id.value}/view`);
		expect(workHref).toBe(`/queue/${id.value}/view?queue=work`);
		expect(viaWork.status).toBe(200);
		expect(viaWork.text).toBe(viaAll.text);
		expect(matter(viaAll.text).data).toEqual({
			title: "Hello World",
			source: url,
			site: "example.com",
			description: "Parsed blurb.",
			created: "2026-09-30T01:02:03.000Z",
			words: 3,
			readplace_id: id.value,
			readplace_url: `${TEST_APP_ORIGIN}/queue/${id.value}/view`,
			readplace_status: "unread",
			readplace_read_time: 1,
			readplace_readlists: ["All", "Work"],
			readplace_content_status: "ready",
			readplace_summary_status: "pending",
		});
	});

	it("serves an article that lives only in a custom readlist and links back to that readlist", async () => {
		const { harness } = buildHarness();
		const userId = UserIdSchema.parse("test-user-123");
		const url = "https://example.com/only-in-work";
		const id = ReaderArticleHashId.from(url).value;
		const work = ReadlistSlugSchema.parse("work");
		await harness.articleStore.createReadlistDefinition({
			userId,
			slug: work,
			label: "Work",
			createdAt: new Date("2026-09-30T02:00:00.000Z"),
		});
		await harness.articleStore.saveReadlistArticle({
			userId,
			readlist: work,
			url,
			metadata: { title: "Only In Work", siteName: "example.com", excerpt: "Parsed blurb.", wordCount: 3 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-09-30T03:04:05.000Z"),
		});
		await harness.articleStore.writeContent({ url, content: "<p>Body copy.</p>" });
		await harness.articleCrawl.markCrawlReady({ url });
		const token = await createAccessToken(harness);

		const collection = await sirenGet(harness, { path: "/queue?queue=work", token });
		const readHref = firstReadHref(collection);
		const response = await markdownGet(harness, { path: readHref, token });

		expect(readHref).toBe(`/queue/${id}/view?queue=work`);
		expect(response.status).toBe(200);
		expect(matter(response.text).data).toEqual({
			title: "Only In Work",
			source: url,
			site: "example.com",
			description: "Parsed blurb.",
			created: "2026-09-30T03:04:05.000Z",
			words: 3,
			readplace_id: id,
			readplace_url: `${TEST_APP_ORIGIN}${readHref}`,
			readplace_status: "unread",
			readplace_read_time: 1,
			readplace_readlists: ["Work"],
			readplace_content_status: "ready",
			readplace_summary_status: "pending",
		});
	});

	it("delivers an article whose crawl is pending at once, without the older body still stored", async () => {
		const { harness } = buildHarness();
		const url = "https://example.com/post";
		const id = ReaderArticleHashId.from(url).value;
		await harness.articleStore.saveArticle({
			userId: UserIdSchema.parse("test-user-123"),
			url,
			metadata: { title: "Hello World", siteName: "example.com", excerpt: "Parsed blurb.", wordCount: 3 },
			estimatedReadTime: MinutesSchema.parse(1),
			provenance: { kind: "web" },
			savedAt: new Date("2026-09-30T01:02:03.000Z"),
		});
		await harness.articleStore.writeContent({ url, content: "<p>Older body.</p>" });
		await harness.articleCrawl.markCrawlPending({ url });
		const token = await createAccessToken(harness);

		const response = await markdownGet(harness, { path: `/queue/${id}/view`, token });

		expect(response.status).toBe(200);
		const document = matter(response.text);
		expect(document.data).toEqual({
			title: "Hello World",
			source: url,
			site: "example.com",
			description: "Parsed blurb.",
			created: "2026-09-30T01:02:03.000Z",
			words: 3,
			readplace_id: id,
			readplace_url: `${TEST_APP_ORIGIN}/queue/${id}/view`,
			readplace_status: "unread",
			readplace_read_time: 1,
			readplace_readlists: ["All"],
			readplace_content_status: "processing",
			readplace_summary_status: "pending",
		});
		expect(document.content).toBe("");
	});
});
