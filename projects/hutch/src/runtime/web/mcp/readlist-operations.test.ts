import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG, READLIST_MAX_PER_USER, ReadlistSlugSchema } from "@packages/domain/readlist";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import type { SaveArticleParams } from "@packages/provider-contracts/article-store";
import { initAddArticleToReadlist, initUpsertReadlist } from "@packages/save-article";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initResolveOwnedArticle } from "./article-lookup";
import { initResolveReadlistMembership } from "./readlist-membership";
import { initMcpReadlistOperations } from "./readlist-operations";

const userId = authenticatedUserIdFrom("00000000000000000000000000000001");
const otherUserId = authenticatedUserIdFrom("00000000000000000000000000000002");

function buildOps() {
	const store = initInMemoryArticleStore();
	let sequence = 0;
	const ops = initMcpReadlistOperations({
		listReadlistDefinitions: store.listReadlistDefinitions,
		upsertReadlist: initUpsertReadlist({
			...store,
			generateReadlistSlug: () => ReadlistSlugSchema.parse(`list-${++sequence}`),
			now: () => new Date(`2026-01-${String(sequence).padStart(2, "0")}`),
		}),
		addArticleToReadlist: initAddArticleToReadlist(store),
		resolveOwnedArticle: initResolveOwnedArticle(store),
		resolveReadlistMembership: initResolveReadlistMembership(store),
	});
	return { store, ops };
}

function saveParams(): SaveArticleParams {
	return {
		userId,
		url: "https://example.com/a",
		metadata: { title: "Article", siteName: "Example", excerpt: "An excerpt", wordCount: 400 },
		estimatedReadTime: MinutesSchema.parse(2),
		provenance: { kind: "web" },
		savedAt: new Date("2026-01-01"),
	};
}

describe("initMcpReadlistOperations", () => {
	it("lists All before owned readlists in creation order, without exposing another reader's definitions", async () => {
		const { store, ops } = buildOps();
		const first = ReadlistSlugSchema.parse("first");
		const second = ReadlistSlugSchema.parse("second");
		await store.createReadlistDefinition({ userId, slug: second, label: "Second", createdAt: new Date("2026-02-01") });
		await store.createReadlistDefinition({ userId, slug: first, label: "First", createdAt: new Date("2026-01-01") });
		await store.createReadlistDefinition({ userId: otherUserId, slug: ReadlistSlugSchema.parse("private"), label: "Private", createdAt: new Date("2025-01-01") });
		expect(await ops.listReadlists({ userId })).toEqual([
			{ id: DEFAULT_READLIST_SLUG, name: "All" },
			{ id: first, name: "First" },
			{ id: second, name: "Second" },
		]);
	});

	it("creates a readlist and reuses its id and original name case-insensitively", async () => {
		const { ops } = buildOps();
		const created = await ops.createReadlist({ userId, name: " Work " });
		assert(created.status === "created");
		expect(created.readlist).toEqual({ id: ReadlistSlugSchema.parse("list-1"), name: "Work" });
		expect(await ops.createReadlist({ userId, name: "work" })).toEqual({ status: "exists", readlist: created.readlist });
	});

	it.each([
		["", { status: "invalid_name" }],
		["ALL", { status: "reserved_name", readlist: { id: DEFAULT_READLIST_SLUG, name: "All" } }],
	])("refuses the name %p without creating a readlist", async (name, expected) => {
		const { ops } = buildOps();
		expect(await ops.createReadlist({ userId, name })).toEqual(expected);
		expect(await ops.listReadlists({ userId })).toEqual([{ id: DEFAULT_READLIST_SLUG, name: "All" }]);
	});

	it("reports the cap on creation and filing without creating or assigning a readlist", async () => {
		const { store, ops } = buildOps();
		const { saved } = await store.saveArticle(saveParams());
		for (let index = 0; index < READLIST_MAX_PER_USER; index++) {
			await ops.createReadlist({ userId, name: `Readlist ${index}` });
		}
		expect(await ops.createReadlist({ userId, name: "One more" })).toEqual({ status: "limit_reached", limit: READLIST_MAX_PER_USER });
		expect(await ops.addToReadlist({ userId, id: saved.id.value, target: { kind: "create", name: "One more" } })).toEqual({ status: "limit_reached", limit: READLIST_MAX_PER_USER });
		expect(await store.listUserSavesForUrl({ userId, url: saved.url })).toEqual([{}]);
		expect((await ops.listReadlists({ userId })).length).toBe(READLIST_MAX_PER_USER + 1);
	});

	it("files a saved article under a newly created name and returns its updated membership", async () => {
		const { store, ops } = buildOps();
		const { saved } = await store.saveArticle(saveParams());
		const result = await ops.addToReadlist({ userId, id: saved.id.value, target: { kind: "create", name: "Work" } });
		assert(result.status === "filed");
		expect(result.article).toMatchObject({
			id: saved.id.value,
			readlists: [{ id: DEFAULT_READLIST_SLUG, name: "All" }, result.readlist],
		});
		const copy = await store.findReadlistArticleById({ userId, id: saved.id, readlist: result.readlist.id });
		assert(copy);
		expect(copy.savedAt.getTime()).toBeGreaterThan(saved.savedAt.getTime());
		expect(await ops.addToReadlist({ userId, id: saved.id.value, target: { kind: "create", name: "work" } })).toMatchObject({ status: "already_filed", readlist: result.readlist, article: result.article });
		expect((await ops.listReadlists({ userId })).length).toBe(2);
	});

	it("files into an existing readlist and keeps an already-filed copy's position", async () => {
		const { store, ops } = buildOps();
		const { saved } = await store.saveArticle(saveParams());
		const created = await ops.createReadlist({ userId, name: "Work" });
		assert(created.status === "created");
		const params = { userId, id: saved.id.value, target: { kind: "existing" as const, readlist: created.readlist.id } };
		expect(await ops.addToReadlist(params)).toMatchObject({ status: "filed", readlist: created.readlist });
		const before = await store.findReadlistArticleById({ userId, id: saved.id, readlist: created.readlist.id });
		expect(await ops.addToReadlist(params)).toMatchObject({ status: "already_filed", readlist: created.readlist });
		expect(await store.findReadlistArticleById({ userId, id: saved.id, readlist: created.readlist.id })).toEqual(before);
	});

	it("files from a named readlist after removal from All, including putting the article back into All", async () => {
		const { store, ops } = buildOps();
		const work = await ops.createReadlist({ userId, name: "Work" });
		const weekend = await ops.createReadlist({ userId, name: "Weekend" });
		assert(work.status === "created" && weekend.status === "created");
		const { saved } = await store.saveReadlistArticle({ ...saveParams(), readlist: work.readlist.id });
		expect(await store.findArticleById(saved.id, userId)).toBeNull();
		expect(await ops.addToReadlist({ userId, id: saved.id.value, target: { kind: "existing", readlist: weekend.readlist.id } })).toMatchObject({ status: "filed", article: { readlists: [work.readlist, weekend.readlist] } });
		expect(await ops.addToReadlist({ userId, id: saved.id.value, target: { kind: "existing", readlist: DEFAULT_READLIST_SLUG } })).toMatchObject({
			status: "filed",
			article: { readlists: [{ id: DEFAULT_READLIST_SLUG, name: "All" }, work.readlist, weekend.readlist] },
		});
		expect(await store.findArticleById(saved.id, userId)).toMatchObject({ url: saved.url });
	});

	it("uses the saved URL when filing and resolving membership for a merged article", async () => {
		const { store, ops } = buildOps();
		const { saved } = await store.saveArticle(saveParams());
		await store.setDisplayUrl({ url: saved.url, displayUrl: "https://example.com/destination" });
		const result = await ops.addToReadlist({ userId, id: saved.id.value, target: { kind: "create", name: "Work" } });
		assert(result.status === "filed");
		expect(result.article.url).toBe("https://example.com/destination");
		expect(result.article.readlists).toEqual([{ id: DEFAULT_READLIST_SLUG, name: "All" }, result.readlist]);
		expect(await store.listUserSavesForUrl({ userId, url: saved.url })).toEqual([{}, { readlist: result.readlist.id }]);
	});

	it.each(["not-a-hash", "0".repeat(32)])("does not create a readlist for a missing or malformed article id %p", async (id) => {
		const { ops } = buildOps();
		expect(await ops.addToReadlist({ userId, id, target: { kind: "create", name: "Work" } })).toEqual({ status: "article_not_found" });
		expect(await ops.listReadlists({ userId })).toEqual([{ id: DEFAULT_READLIST_SLUG, name: "All" }]);
	});

	it("does not reach another reader's article", async () => {
		const { store, ops } = buildOps();
		const { saved } = await store.saveArticle({ ...saveParams(), userId: otherUserId });
		expect(await ops.addToReadlist({ userId, id: saved.id.value, target: { kind: "create", name: "Work" } })).toEqual({ status: "article_not_found" });
		expect(await ops.listReadlists({ userId })).toEqual([{ id: DEFAULT_READLIST_SLUG, name: "All" }]);
	});

	it("treats an unowned readlist id like an unknown id without assigning any copy", async () => {
		const { store, ops } = buildOps();
		const { saved } = await store.saveArticle(saveParams());
		const privateReadlist = await ops.createReadlist({ userId: otherUserId, name: "Private" });
		assert(privateReadlist.status === "created");
		for (const readlist of [privateReadlist.readlist.id, ReadlistSlugSchema.parse("unknown")]) {
			expect(await ops.addToReadlist({ userId, id: saved.id.value, target: { kind: "existing", readlist } })).toEqual({ status: "readlist_not_found" });
		}
		expect(await store.listUserSavesForUrl({ userId, url: saved.url })).toEqual([{}]);
	});

	it.each([
		["", { status: "invalid_name" }],
		["All", { status: "reserved_name", readlist: { id: DEFAULT_READLIST_SLUG, name: "All" } }],
	])("does not file when the requested name %p is rejected", async (name, expected) => {
		const { store, ops } = buildOps();
		const { saved } = await store.saveArticle(saveParams());
		expect(await ops.addToReadlist({ userId, id: saved.id.value, target: { kind: "create", name } })).toEqual(expected);
		expect(await store.listUserSavesForUrl({ userId, url: saved.url })).toEqual([{}]);
	});
});
