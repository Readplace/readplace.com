import assert from "node:assert/strict";
import { ReaderArticleHashId, calculateReadTime } from "@packages/domain/article";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { createDefaultTestAppFixture, TEST_APP_ORIGIN } from "@packages/test-fixtures";
import request from "supertest";
import { BROWSER_REQUEST_HEADERS, useTestServer } from "../../../test-app";

const UPLOAD_ID = "0123456789abcdef0123456789abcdef";
const PRIVATE_URL = `https://uploads.readplace.invalid/${UPLOAD_ID}`;
const bookId = ReaderArticleHashId.from(PRIVATE_URL);
const BOOK_ID = bookId.value;
const FILE = `${"ab".repeat(32)}.png`;
const OWNER = { email: "owner@example.com", password: "password123" };
const NOT_THE_OWNER = { email: "someone-else@example.com", password: "password123" };

const useApp = useTestServer();

async function appWithOwnersBook() {
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const recordedViews: string[] = [];
	const harness = useApp({
		...fixture,
		articleStore: {
			...fixture.articleStore,
			markArticleViewed: async ({ url }) => {
				recordedViews.push(url);
			},
			markReadlistArticleViewed: async ({ url }) => {
				recordedViews.push(url);
			},
		},
	});
	const owner = await harness.auth.createUser(OWNER);
	assert(owner.ok, "owner should be created");
	await fixture.articleStore.savePrivateItem({
		url: PRIVATE_URL,
		ownerUserId: owner.userId,
		media: { kind: "book", fileName: "dune.epub" },
		savedAt: new Date("2026-11-05T00:00:00.000Z"),
	});
	const signIn = async (credentials: typeof OWNER) => {
		const agent = request.agent(harness.server);
		await agent.post("/login").set(BROWSER_REQUEST_HEADERS).type("form").send(credentials);
		return agent;
	};
	return { fixture, harness, ownerUserId: owner.userId, recordedViews, signIn };
}

describe("GET /queue/:id/media/:file", () => {
	it("redirects the owner to a presigned URL that no shared cache may keep", async () => {
		const { fixture, recordedViews, signIn } = await appWithOwnersBook();
		const agent = await signIn(OWNER);

		const response = await agent.get(`/queue/${BOOK_ID}/media/${FILE}`).set(BROWSER_REQUEST_HEADERS);

		assert.equal(response.status, 302);
		assert.equal(response.headers.location, `https://media.test/images/${UPLOAD_ID}/${FILE}`);
		assert.equal(response.headers["cache-control"], "private, no-store");
		assert.deepEqual(fixture.mediaUpload.presignedMediaImages, [{ uploadId: UPLOAD_ID, file: FILE }]);
		assert.deepEqual(recordedViews, []);
	});

	it("redirects the owner of a book filed in another readlist with no queue on the request", async () => {
		const { fixture, ownerUserId, signIn } = await appWithOwnersBook();
		const agent = await signIn(OWNER);
		const created = await agent
			.post("/queue/queues")
			.set(BROWSER_REQUEST_HEADERS)
			.type("form")
			.send({ label: "Sci-fi" });
		const readlist = ReadlistSlugSchema.parse(new URL(created.headers.location, TEST_APP_ORIGIN).searchParams.get("queue"));
		const filed = await agent
			.post(`/queue/${BOOK_ID}/assign`)
			.set(BROWSER_REQUEST_HEADERS)
			.type("form")
			.send({ queue: readlist, returnTo: "/queue" });
		assert.equal(filed.status, 303);
		assert.equal(await fixture.articleStore.deleteArticle(bookId, ownerUserId), true);
		assert.equal(await fixture.articleStore.findArticleById(bookId, ownerUserId), null);
		assert(await fixture.articleStore.findReadlistArticleById({ id: bookId, userId: ownerUserId, readlist }));

		const response = await agent.get(`/queue/${BOOK_ID}/media/${FILE}`).set(BROWSER_REQUEST_HEADERS);

		assert.equal(response.status, 302);
		assert.equal(response.headers.location, `https://media.test/images/${UPLOAD_ID}/${FILE}`);
	});

	it("answers another reader with a 404", async () => {
		const { fixture, harness, signIn } = await appWithOwnersBook();
		const other = await harness.auth.createUser(NOT_THE_OWNER);
		assert(other.ok, "the other reader should be created");
		const agent = await signIn(NOT_THE_OWNER);

		const response = await agent.get(`/queue/${BOOK_ID}/media/${FILE}`).set(BROWSER_REQUEST_HEADERS);

		assert.equal(response.status, 404);
		assert.deepEqual(fixture.mediaUpload.presignedMediaImages, []);
	});

	it("answers a logged-out request with a 404 and no redirect, so an img never lands on the login page", async () => {
		const { fixture, harness } = await appWithOwnersBook();

		const response = await request(harness.server).get(`/queue/${BOOK_ID}/media/${FILE}`).set(BROWSER_REQUEST_HEADERS);

		assert.equal(response.status, 404);
		assert.equal(response.headers.location, undefined);
		assert.deepEqual(fixture.mediaUpload.presignedMediaImages, []);
	});

	it("answers a public row with a 404", async () => {
		const { fixture, signIn } = await appWithOwnersBook();
		const publicUrl = "https://example.com/an-article";
		await fixture.articleStore.saveArticleGlobally({
			url: publicUrl,
			metadata: { title: "An article", siteName: "example.com", excerpt: "", wordCount: 9 },
			estimatedReadTime: calculateReadTime(9),
			savedAt: new Date("2026-11-05T00:00:00.000Z"),
		});
		const publicId = ReaderArticleHashId.from(publicUrl);
		assert.equal(await fixture.articleStore.findArticleUrlById(publicId), publicUrl);
		const agent = await signIn(OWNER);

		const response = await agent.get(`/queue/${publicId.value}/media/${FILE}`).set(BROWSER_REQUEST_HEADERS);

		assert.equal(response.status, 404);
		assert.deepEqual(fixture.mediaUpload.presignedMediaImages, []);
	});

	it.each([
		["a file name that climbs out of the prefix", `/queue/${BOOK_ID}/media/..%2Fx`],
		["a file name with a disallowed extension", `/queue/${BOOK_ID}/media/abc.exe`],
		["an id that is not a route id", `/queue/not-a-route-id/media/${FILE}`],
		["an id no article has", `/queue/ffffffffffffffffffffffffffffffff/media/${FILE}`],
	])("answers the owner's request for %s with a 404", async (_label, path) => {
		const { fixture, signIn } = await appWithOwnersBook();
		const agent = await signIn(OWNER);

		const response = await agent.get(path).set(BROWSER_REQUEST_HEADERS);

		assert.equal(response.status, 404);
		assert.deepEqual(fixture.mediaUpload.presignedMediaImages, []);
	});
});
