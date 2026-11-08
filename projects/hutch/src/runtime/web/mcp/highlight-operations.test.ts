import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { CandidateIdSchema } from "@packages/article-state-types";
import {
	HIGHLIGHT_NOTE_MAX_LENGTH,
	type Highlight,
	HighlightIdSchema,
	MinutesSchema,
	ReaderArticleHashId,
	storedArticleBody,
	viewerFor,
} from "@packages/domain/article";
import { describeRange } from "@packages/domain/article/highlight";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import type { SaveArticleParams } from "@packages/provider-contracts/article-store";
import { TEST_APP_ORIGIN } from "@packages/test-fixtures";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initInMemoryHighlights } from "@packages/test-fixtures/providers/highlights";
import {
	type CreateReaderHighlight,
	initCreateReaderHighlight,
} from "../shared/article-body/highlights/create-reader-highlight";
import {
	prepareReaderContent,
	WHOLE_DOCUMENT_SECTION,
} from "../shared/article-body/reader-slot/reader-content";
import { servedContentHash } from "../shared/article-body/reader-slot/served-content-hash";
import { initResolveOwnedArticle } from "./article-lookup";
import { initMcpHighlightOperations } from "./highlight-operations";

const userId = authenticatedUserIdFrom("00000000000000000000000000000001");
const otherUserId = authenticatedUserIdFrom("00000000000000000000000000000002");
const URL_A = "https://example.com/a";
const ROW_KEY = ArticleResourceUniqueId.parse(URL_A).value;
const ID_A = ReaderArticleHashId.from(URL_A).value;
const CREATED_AT = new Date("2026-11-01T10:00:00.000Z");

function saveParams(url = URL_A): SaveArticleParams {
	return {
		userId,
		url,
		metadata: { title: "Article", siteName: "Example", excerpt: "An excerpt", wordCount: 400 },
		estimatedReadTime: MinutesSchema.parse(2),
		provenance: { kind: "web" },
		savedAt: new Date("2026-01-01"),
	};
}

function servedText(html: string, url = URL_A): string {
	const stored = storedArticleBody({ url, html, viewer: viewerFor(userId), ownerUserId: undefined });
	assert(stored.kind === "article");
	return prepareReaderContent({
		content: stored.body,
		appOrigin: TEST_APP_ORIGIN,
		url,
		section: WHOLE_DOCUMENT_SECTION,
	}).text;
}

function build(options: { createHighlight?: CreateReaderHighlight } = {}) {
	const store = initInMemoryArticleStore();
	const highlights = initInMemoryHighlights();
	const createReaderHighlight = initCreateReaderHighlight({
		listArticleHighlights: highlights.listArticleHighlights,
		createHighlight: highlights.createHighlight,
		newHighlightId: randomUUID,
		now: () => CREATED_AT,
	});
	const ops = initMcpHighlightOperations({
		resolveOwnedArticle: initResolveOwnedArticle(store),
		readArticleContent: async ({ url, viewer }) =>
			storedArticleBody({
				url,
				html: await store.readContent(ArticleResourceUniqueId.parse(url)),
				viewer,
				ownerUserId: await store.findItemOwner(url),
			}),
		readCanonicalSnapshot: store.readCanonicalSnapshot,
		listArticleHighlights: highlights.listArticleHighlights,
		createHighlight: options.createHighlight ?? createReaderHighlight,
		appOrigin: TEST_APP_ORIGIN,
	});
	return { store, highlights, ops };
}

async function seedArticle(
	harness: ReturnType<typeof build>,
	params: { html: string; hash?: string },
): Promise<void> {
	await harness.store.saveArticle(saveParams());
	if (params.hash === undefined) {
		await harness.store.writeContent({ url: URL_A, content: params.html });
		return;
	}
	await harness.store.replaceCanonicalContent({
		url: URL_A,
		content: params.html,
		canonicalContentHash: params.hash,
		canonicalCandidateId: CandidateIdSchema.parse("candidate-1"),
	});
}

function rows(harness: ReturnType<typeof build>) {
	return harness.highlights.listArticleHighlights({ userId, url: ROW_KEY });
}

function seededRow(overrides: Partial<Highlight> & Pick<Highlight, "exact" | "start" | "end">): Highlight {
	return {
		prefix: "",
		suffix: "",
		highlightId: HighlightIdSchema.parse(randomUUID()),
		highlightOf: ROW_KEY,
		anchoredContentHash: "hash-1",
		anchorState: "anchored",
		orderKey: overrides.start,
		createdAt: CREATED_AT,
		updatedAt: CREATED_AT,
		anchorRevision: 0,
		...overrides,
	};
}

const BODY = "<p>Readplace keeps the passages you highlight.</p><p>Notes sit beside them.</p>";

describe("initMcpHighlightOperations", () => {
	describe("listHighlights", () => {
		it("lists highlights in reading order as anchored, moved and orphaned against the current body", async () => {
			const harness = build();
			await seedArticle(harness, { html: BODY, hash: "hash-1" });
			const second = await harness.ops.createHighlight({ userId, id: ID_A, quote: "Notes sit beside them." });
			const first = await harness.ops.createHighlight({ userId, id: ID_A, quote: "keeps the passages" });
			assert(second.status === "created" && first.status === "created");
			await harness.store.replaceCanonicalContent({
				url: URL_A,
				content: "<p>A new opening.</p><p>Readplace keeps the passages you highlight.</p>",
				canonicalContentHash: "hash-2",
				canonicalCandidateId: CandidateIdSchema.parse("candidate-2"),
			});

			const listed = await harness.ops.listHighlights({ userId, id: ID_A });

			assert(listed.status === "ready");
			expect(listed.articleId).toBe(ID_A);
			expect(listed.highlights.map(({ id, quote, state }) => ({ id, quote, state }))).toEqual([
				{ id: first.highlight.id, quote: "keeps the passages", state: "moved" },
				{ id: second.highlight.id, quote: "Notes sit beside them.", state: "orphaned" },
			]);
		});

		it("lists a highlight anchored at the canonical hash with its note and ISO timestamps", async () => {
			const harness = build();
			await seedArticle(harness, { html: BODY, hash: "hash-1" });
			await harness.ops.createHighlight({ userId, id: ID_A, quote: "keeps the passages", note: "Remember" });

			const listed = await harness.ops.listHighlights({ userId, id: ID_A });

			assert(listed.status === "ready");
			expect(listed.highlights).toEqual([
				expect.objectContaining({
					quote: "keeps the passages",
					note: "Remember",
					state: "anchored",
					createdAt: CREATED_AT.toISOString(),
					updatedAt: CREATED_AT.toISOString(),
				}),
			]);
		});

		it("keeps a terminal orphan at the current hash orphaned without searching for its passage", async () => {
			const harness = build();
			await seedArticle(harness, { html: BODY, hash: "hash-1" });
			await harness.highlights.createHighlight({
				userId,
				highlight: seededRow({ exact: "Notes sit beside them.", start: 0, end: 22, anchorState: "orphaned" }),
				replacedIds: [],
			});

			const listed = await harness.ops.listHighlights({ userId, id: ID_A });

			assert(listed.status === "ready");
			expect(listed.highlights.map((highlight) => highlight.state)).toEqual(["orphaned"]);
		});

		it("orders highlights that share a position by id", async () => {
			const harness = build();
			await seedArticle(harness, { html: BODY, hash: "hash-1" });
			const text = servedText(BODY);
			const selector = describeRange({ text, start: 0, end: 9 });
			const ids = ["bbbbbbbb-0000-4000-8000-000000000000", "aaaaaaaa-0000-4000-8000-000000000000"];
			for (const id of ids) {
				await harness.highlights.createHighlight({
					userId,
					highlight: seededRow({ ...selector, highlightId: HighlightIdSchema.parse(id) }),
					replacedIds: [],
				});
			}

			const listed = await harness.ops.listHighlights({ userId, id: ID_A });

			assert(listed.status === "ready");
			expect(listed.highlights.map((highlight) => highlight.id)).toEqual([...ids].reverse());
		});

		it("lists a row seeded under the article's resource key, as the web route writes it", async () => {
			const harness = build();
			await seedArticle(harness, { html: BODY, hash: "hash-1" });
			const text = servedText(BODY);
			const start = text.indexOf("the passages");
			await harness.highlights.createHighlight({
				userId,
				highlight: seededRow({ ...describeRange({ text, start, end: start + 12 }) }),
				replacedIds: [],
			});

			const listed = await harness.ops.listHighlights({ userId, id: ID_A });

			assert(listed.status === "ready");
			expect(listed.highlights.map((highlight) => highlight.quote)).toEqual(["the passages"]);
		});

		it("names the readlist an article is filed in when it is only in a named readlist", async () => {
			const harness = build();
			const readlist = ReadlistSlugSchema.parse("work");
			await harness.store.createReadlistDefinition({ userId, slug: readlist, label: "Work", createdAt: CREATED_AT });
			await harness.store.saveReadlistArticle({ ...saveParams(), readlist });
			await harness.store.writeContent({ url: URL_A, content: BODY });

			const listed = await harness.ops.listHighlights({ userId, id: ID_A });

			expect(listed).toEqual({ status: "ready", articleId: ID_A, readlist, highlights: [] });
		});

		it("answers not_found for an unknown id and for another reader's article", async () => {
			const harness = build();
			await seedArticle(harness, { html: BODY });

			expect(await harness.ops.listHighlights({ userId, id: "unknown" })).toEqual({ status: "not_found" });
			expect(await harness.ops.listHighlights({ userId: otherUserId, id: ID_A })).toEqual({ status: "not_found" });
		});

		it("answers not_an_article for a webmail page and pending while the body is not fetched", async () => {
			const harness = build();
			const mail = "https://mail.google.com/mail/u/0/";
			await harness.store.saveArticle(saveParams(mail));
			await harness.store.saveArticle(saveParams());

			expect(
				await harness.ops.listHighlights({ userId, id: ReaderArticleHashId.from(mail).value }),
			).toEqual({ status: "not_an_article" });
			expect(await harness.ops.listHighlights({ userId, id: ID_A })).toEqual({ status: "pending" });
		});
	});

	describe("createHighlight", () => {
		it("stores describeRange's selector and the canonical snapshot's hash", async () => {
			const harness = build();
			await seedArticle(harness, { html: BODY, hash: "hash-1" });
			const text = servedText(BODY);
			const start = text.indexOf("keeps the passages");

			const result = await harness.ops.createHighlight({ userId, id: ID_A, quote: "keeps the passages" });

			assert(result.status === "created");
			expect(result.articleId).toBe(ID_A);
			expect(result.highlight).toEqual({
				id: result.highlight.id,
				quote: "keeps the passages",
				state: "anchored",
				createdAt: CREATED_AT.toISOString(),
				updatedAt: CREATED_AT.toISOString(),
			});
			const [row] = await rows(harness);
			expect(row).toMatchObject({
				...describeRange({ text, start, end: start + "keeps the passages".length }),
				anchoredContentHash: "hash-1",
				anchoredCandidateId: "candidate-1",
			});
		});

		it("stores the served text's hash when the article has no canonical snapshot", async () => {
			const harness = build();
			await seedArticle(harness, { html: BODY });

			await harness.ops.createHighlight({ userId, id: ID_A, quote: "keeps the passages" });

			const [row] = await rows(harness);
			expect(row.anchoredContentHash).toBe(servedContentHash(servedText(BODY)));
		});

		it("merges with an overlapping highlight at the canonical hash and joins the notes", async () => {
			const harness = build();
			await seedArticle(harness, { html: BODY, hash: "hash-1" });
			await harness.ops.createHighlight({ userId, id: ID_A, quote: "keeps the passages", note: "First" });

			const result = await harness.ops.createHighlight({
				userId,
				id: ID_A,
				quote: "the passages you highlight",
				note: "Second",
			});

			assert(result.status === "merged");
			expect(result.highlight.quote).toBe("keeps the passages you highlight");
			const stored = await rows(harness);
			expect(stored).toHaveLength(1);
			expect(stored[0].note).toBe(result.highlight.note);
			expect(stored[0].note).toContain("First");
			expect(stored[0].note).toContain("Second");
		});

		it("merges over a moved passage's new position and creates over only its stale offsets", async () => {
			const harness = build();
			await seedArticle(harness, { html: "<p>alpha beta gamma delta epsilon</p>", hash: "hash-1" });
			await harness.ops.createHighlight({ userId, id: ID_A, quote: "alpha beta" });
			const [before] = await rows(harness);
			await harness.store.replaceCanonicalContent({
				url: URL_A,
				content: "<p>zeta eta alpha beta gamma delta epsilon</p>",
				canonicalContentHash: "hash-2",
				canonicalCandidateId: CandidateIdSchema.parse("candidate-2"),
			});

			const stale = await harness.ops.createHighlight({ userId, id: ID_A, quote: "zeta eta" });
			expect(stale.status).toBe("created");
			expect((await rows(harness)).find((row) => row.highlightId === before.highlightId)).toEqual(before);

			const moved = await harness.ops.createHighlight({ userId, id: ID_A, quote: "beta gamma" });
			assert(moved.status === "merged");
			expect(moved.highlight.quote).toBe("alpha beta gamma");
		});

		it("creates over an orphaned row's stored offsets and leaves the orphan unchanged", async () => {
			const harness = build();
			await seedArticle(harness, { html: "<p>alpha beta gamma</p>", hash: "hash-1" });
			await harness.ops.createHighlight({ userId, id: ID_A, quote: "alpha beta" });
			const [orphan] = await rows(harness);
			await harness.store.replaceCanonicalContent({
				url: URL_A,
				content: "<p>omega sigma tau</p>",
				canonicalContentHash: "hash-2",
				canonicalCandidateId: CandidateIdSchema.parse("candidate-2"),
			});

			const result = await harness.ops.createHighlight({ userId, id: ID_A, quote: "omega sigma" });

			expect(result.status).toBe("created");
			const stored = await rows(harness);
			expect(stored).toHaveLength(2);
			expect(stored.find((row) => row.highlightId === orphan.highlightId)).toEqual(orphan);
		});

		it("merges with a row seeded under the article's resource key", async () => {
			const harness = build();
			await seedArticle(harness, { html: BODY, hash: "hash-1" });
			const text = servedText(BODY);
			const start = text.indexOf("the passages");
			await harness.highlights.createHighlight({
				userId,
				highlight: seededRow({ ...describeRange({ text, start, end: start + 12 }) }),
				replacedIds: [],
			});

			const result = await harness.ops.createHighlight({ userId, id: ID_A, quote: "passages you" });

			expect(result.status).toBe("merged");
			expect(await rows(harness)).toHaveLength(1);
		});

		it("refuses a merge whose passage would exceed the cap and writes nothing", async () => {
			const harness = build();
			const words = Array.from({ length: 1700 }, (_, index) => `w${index}`).join(" ");
			await seedArticle(harness, { html: `<p>${words}</p>`, hash: "hash-1" });
			const text = servedText(`<p>${words}</p>`);
			const existingEnd = text.indexOf(" w1500 ");
			await harness.highlights.createHighlight({
				userId,
				highlight: seededRow({ ...describeRange({ text, start: 0, end: existingEnd }) }),
				replacedIds: [],
			});
			const before = await rows(harness);

			const result = await harness.ops.createHighlight({
				userId,
				id: ID_A,
				quote: text.slice(text.indexOf("w1499 "), text.indexOf(" w1699")),
			});

			expect(result).toEqual({ status: "too_long", limit: 8191 });
			expect(await rows(harness)).toEqual(before);
		});

		it("refuses a merge whose joined notes would exceed the cap and writes nothing", async () => {
			const harness = build();
			await seedArticle(harness, { html: BODY, hash: "hash-1" });
			await harness.ops.createHighlight({ userId, id: ID_A, quote: "keeps the passages", note: "a".repeat(8000) });
			const before = await rows(harness);

			const result = await harness.ops.createHighlight({
				userId,
				id: ID_A,
				quote: "the passages you",
				note: "b".repeat(500),
			});

			expect(result).toEqual({ status: "too_long", limit: HIGHLIGHT_NOTE_MAX_LENGTH });
			expect(await rows(harness)).toEqual(before);
		});

		it("answers not_found for an unknown id and another reader's article, writing nothing", async () => {
			const harness = build();
			await seedArticle(harness, { html: BODY });

			expect(await harness.ops.createHighlight({ userId, id: "unknown", quote: "keeps" })).toEqual({ status: "not_found" });
			expect(await harness.ops.createHighlight({ userId: otherUserId, id: ID_A, quote: "keeps" })).toEqual({ status: "not_found" });
			expect(await rows(harness)).toEqual([]);
		});

		it("answers not_an_article for a webmail page and pending while the body is not fetched", async () => {
			const harness = build();
			const mail = "https://mail.google.com/mail/u/0/";
			await harness.store.saveArticle(saveParams(mail));
			await harness.store.saveArticle(saveParams());

			expect(
				await harness.ops.createHighlight({ userId, id: ReaderArticleHashId.from(mail).value, quote: "Inbox" }),
			).toEqual({ status: "not_an_article" });
			expect(await harness.ops.createHighlight({ userId, id: ID_A, quote: "keeps" })).toEqual({ status: "pending" });
		});

		it("answers quote_not_found for a quote that is not in the article", async () => {
			const harness = build();
			await seedArticle(harness, { html: BODY });

			expect(await harness.ops.createHighlight({ userId, id: ID_A, quote: "absent words" })).toEqual({
				status: "quote_not_found",
			});
		});

		it.each([" ", "<br>"])("answers quote_not_found for the invisible quote %j", async (quote) => {
			const harness = build();
			await seedArticle(harness, { html: BODY });

			expect(await harness.ops.createHighlight({ userId, id: ID_A, quote })).toEqual({ status: "quote_not_found" });
			expect(await rows(harness)).toEqual([]);
		});

		it("answers quote_ambiguous with the match count when text_before does not pick one", async () => {
			const harness = build();
			await seedArticle(harness, { html: "<p>one echo</p><p>two echo</p><p>three echo</p>" });

			expect(await harness.ops.createHighlight({ userId, id: ID_A, quote: "echo" })).toEqual({
				status: "quote_ambiguous",
				matches: 3,
			});
			expect(
				await harness.ops.createHighlight({ userId, id: ID_A, quote: "echo", textBefore: "nowhere" }),
			).toEqual({ status: "quote_ambiguous", matches: 3 });
		});

		it.each([
			["an entity", "Salt &amp; pepper", "Salt & pepper"],
			["an inline tag", "Salt <em>and</em> pepper", "Salt and pepper"],
		])("stores the decoded passage for a quote holding %s", async (_label, quote, exact) => {
			const harness = build();
			await seedArticle(harness, { html: "<p>Salt &amp; pepper. Salt and pepper.</p>" });

			const result = await harness.ops.createHighlight({ userId, id: ID_A, quote });

			assert(result.status === "created");
			expect(result.highlight.quote).toBe(exact);
		});

		it.each([
			["an entity", "Fish &amp; chips:"],
			["an inline tag", "Fish <em>and</em> chips:"],
		])("picks the occurrence a text_before holding %s names", async (_label, textBefore) => {
			const harness = build();
			const html = "<p>Bread: echo.</p><p>Fish &amp; chips: echo.</p><p>Fish and chips: echo.</p>";
			await seedArticle(harness, { html });
			const text = servedText(html);
			const before = textBefore.includes("&amp;") ? "Fish & chips: " : "Fish and chips: ";
			const start = text.indexOf(before) + before.length;

			const result = await harness.ops.createHighlight({ userId, id: ID_A, quote: "echo", textBefore });

			assert(result.status === "created");
			const [row] = await rows(harness);
			expect({ exact: row.exact, start: row.start, end: row.end }).toEqual({ exact: "echo", start, end: start + 4 });
		});

		it.each([
			["a quote on adjacent block tags", "<p>First block.</p><p>Second block.</p>", "<p>First block.</p><p>Second block.</p>", "First block.\nSecond block."],
			["a line break inside a quote", "<p>line one<br>line two</p>", "line one<br>line two", "line one\nline two"],
			["a literal angle bracket", "<p>if a&lt;b then c&gt;d</p>", "if a<b then c>d", "if a<b then c>d"],
		])("stores the served passage for %s", async (_label, html, quote, exact) => {
			const harness = build();
			await seedArticle(harness, { html });

			const result = await harness.ops.createHighlight({ userId, id: ID_A, quote });

			assert(result.status === "created");
			expect(result.highlight.quote).toBe(exact);
		});

		it("answers conflict when the store cancels the write, and writes no row", async () => {
			const harness = build();
			await seedArticle(harness, { html: BODY });
			harness.highlights.setCreateCancelled(true);

			expect(await harness.ops.createHighlight({ userId, id: ID_A, quote: "keeps" })).toEqual({ status: "conflict" });
			expect(await rows(harness)).toEqual([]);
		});

		it("answers quote_not_found when the describe-and-merge step reports the passage changed", async () => {
			const harness = build({ createHighlight: async () => ({ status: "passage-changed" }) });
			await seedArticle(harness, { html: BODY });

			expect(await harness.ops.createHighlight({ userId, id: ID_A, quote: "keeps" })).toEqual({
				status: "quote_not_found",
			});
		});
	});
});
