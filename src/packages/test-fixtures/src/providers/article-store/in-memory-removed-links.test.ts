import assert from "node:assert/strict";
import { HighlightIdSchema, MinutesSchema, SavedLinksJobIdSchema, type Highlight } from "@packages/domain/article";
import { emailIssueArticleUrl, emailIssueKeyPrefix } from "@packages/domain/inbox";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import type { SaveArticleParams } from "./article-store.types";
import { initInMemoryArticleStore } from "./in-memory-article-store";
import { initInMemoryRemovedLinks } from "./in-memory-removed-links";

const READER = UserIdSchema.parse("reader-1");
const OTHER = UserIdSchema.parse("reader-2");
const CUTOFF = new Date("2026-12-01T00:00:00.000Z");
const SAVED_AT = new Date("2026-11-20T00:00:00.000Z");
const WORK = ReadlistSlugSchema.parse("work");

function emailSave(overrides: Partial<SaveArticleParams> & { url: string }): SaveArticleParams {
	return {
		userId: READER,
		metadata: { title: "Post", siteName: "example.com", excerpt: "", wordCount: 100 },
		estimatedReadTime: MinutesSchema.parse(1),
		provenance: { kind: "email", senderEmail: "dan@tldr.tech" },
		savedAt: SAVED_AT,
		saveTrigger: "automatic",
		...overrides,
	};
}

function highlightOf(url: string): Highlight {
	return {
		highlightId: HighlightIdSchema.parse("6f9a2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b"),
		highlightOf: url,
		exact: "quote",
		prefix: "",
		suffix: "",
		start: 0,
		end: 5,
		anchoredContentHash: "hash",
		anchorState: "anchored",
		orderKey: 0,
		createdAt: SAVED_AT,
		updatedAt: SAVED_AT,
		anchorRevision: 0,
	};
}

async function seededStore() {
	const store = initInMemoryArticleStore();
	await store.saveArticle(emailSave({ url: "https://a.com/selected" }));
	const { saved: read } = await store.saveArticle(emailSave({ url: "https://a.com/read" }));
	await store.updateArticleStatus(read.id, READER, "read");
	await store.saveArticle(emailSave({ url: "https://a.com/opened" }));
	await store.markArticleViewed({ userId: READER, url: "https://a.com/opened", at: SAVED_AT });
	await store.saveArticle(emailSave({ url: "https://a.com/highlighted" }));
	await store.saveArticle(emailSave({ url: "https://a.com/opened-in-readlist" }));
	await store.saveReadlistArticle({ ...emailSave({ url: "https://a.com/opened-in-readlist" }), readlist: WORK });
	await store.markReadlistArticleViewed({ userId: READER, readlist: WORK, url: "https://a.com/opened-in-readlist", at: SAVED_AT });
	await store.saveArticle(emailSave({ url: "https://a.com/summary-opened" }));
	await store.markSummaryToggled({ userId: READER, url: "https://a.com/summary-opened", state: "open", at: SAVED_AT });
	await store.saveArticle(emailSave({ url: "https://a.com/restored" }));
	await store.moveNewsletterLinkToHold({
		userId: READER,
		jobId: SavedLinksJobIdSchema.parse("job-1"),
		storedKey: "a.com/restored",
		cutoff: SAVED_AT,
		senders: { kind: "all" },
		readlists: [],
		now: SAVED_AT,
	});
	const held = await store.findHeldLink({ userId: READER, storedKey: "a.com/restored", now: SAVED_AT });
	assert(held, "the restored link was held first");
	await store.restoreHeldLink({ userId: READER, heldKey: held.heldKey, now: CUTOFF });
	await store.saveArticle(emailSave({ url: "https://a.com/chosen", saveTrigger: "manual" }));
	await store.saveArticle(emailSave({ url: "https://a.com/web", provenance: { kind: "web" }, saveTrigger: "manual" }));
	await store.saveArticle(emailSave({ url: "https://a.com/other", userId: OTHER }));
	await store.saveArticle(
		emailSave({ url: emailIssueArticleUrl({ userId: READER, receivedAtMessageId: "2026-06-24T09:00:00.000Z#<m@x>" }) }),
	);
	return initInMemoryRemovedLinks({
		readNewsletterLinkRows: store.readNewsletterLinkRows,
		listAllUserHighlights: async (userId) => (userId === READER ? [highlightOf("a.com/highlighted")] : []),
	});
}

describe("initInMemoryRemovedLinks", () => {
	it("summarises the reader's newsletter links the way the DynamoDB read does", async () => {
		const removedLinks = await seededStore();

		assert.deepEqual(await removedLinks.summariseNewsletterLinks({ userId: READER, cutoff: CUTOFF }), {
			selected: 5,
			bySender: [{ senderEmail: "dan@tldr.tech", count: 5 }],
			skipped: { read: 1, highlighted: 1, changed: 1, unreadable: 0 },
			earliestEmailSave: SAVED_AT,
		});
	});

	it("finds a newsletter link only for a reader who has one", async () => {
		const removedLinks = await seededStore();

		assert.equal(await removedLinks.hasNewsletterLink({ userId: READER }), true);
		assert.equal(await removedLinks.hasNewsletterLink({ userId: UserIdSchema.parse("reader-3") }), false);
	});

	it("counts the reader's newsletter issues", async () => {
		const removedLinks = await seededStore();

		assert.equal(await removedLinks.countNewsletterIssues({ userId: READER }), 1);
		assert.equal(await removedLinks.countNewsletterIssues({ userId: OTHER }), 0);
	});

	it("hands every All row but the reader's issues to one removal-candidate page", async () => {
		const removedLinks = await seededStore();
		const pages: string[][] = [];

		await removedLinks.forEachRemovalCandidatePage({
			userId: READER,
			onPage: async (candidates) => {
				pages.push(candidates.map((candidate) => (candidate.kind === "row" ? candidate.row.storedKey : "unreadable")));
			},
		});

		assert.equal(pages.length, 1);
		assert.ok(pages[0]?.includes("a.com/chosen"));
		assert.ok(!pages[0]?.includes("a.com/other"));
		assert.ok(!pages[0]?.some((storedKey) => storedKey.startsWith(emailIssueKeyPrefix(READER))));
	});
});
