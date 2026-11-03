import assert from "node:assert/strict";
import { MinutesSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryArticleStore } from "../article-store/in-memory-article-store";
import { initInMemoryPastReads } from "./in-memory-past-reads";
import { initInMemoryRelatedArticles } from "./in-memory-related-articles";
import { initInMemoryRelatedPassRequests } from "./in-memory-related-pass-requests";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const secondReader = UserIdSchema.parse("00000000000000000000000000000002");
const url = "https://example.com/post";
const variantSpelling = "https://EXAMPLE.com/post?utm_source=newsletter";
const earliest = new Date("2026-10-01T00:00:00.000Z");
const later = new Date("2026-10-02T00:00:00.000Z");

function build() {
	const store = initInMemoryArticleStore();
	const related = initInMemoryRelatedArticles({
		findArticleByUrl: store.findArticleByUrl,
		findArticleById: store.findArticleById,
	});
	const pastReads = initInMemoryPastReads({
		findArticleByUrl: store.findArticleByUrl,
		findArticleById: store.findArticleById,
	});
	store.onDefaultRowDeleted(related.forgetRow);
	store.onDefaultRowDeleted(pastReads.forgetRow);
	let now = earliest;
	const requests = initInMemoryRelatedPassRequests({
		readSavedRowRelatedRequest: store.readSavedRowRelatedRequest,
		stampRelatedPassesRequested: store.stampRelatedPassesRequested,
		readSettledNextRead: related.readSettledNextRead,
		readPastReadsState: pastReads.readPastReadsState,
		now: () => now,
	});
	const saveRow = (reader = userId) =>
		store.saveArticle({
			userId: reader,
			url,
			provenance: { kind: "web" },
			savedAt: earliest,
			metadata: { title: "Post", siteName: "example.com", excerpt: "x", wordCount: 1 },
			estimatedReadTime: MinutesSchema.parse(1),
		});
	return { store, related, pastReads, requests, saveRow, advance: () => { now = later; } };
}

describe("initInMemoryRelatedPassRequests", () => {
	it("reports a row that does not exist as not saved and refuses to stamp it", async () => {
		const { requests } = build();

		expect(await requests.readRelatedPassRequestState({ userId, url })).toEqual({ saved: false });
		expect(await requests.markRelatedPassesRequested({ userId, url })).toBe("row-absent");
	});

	it("keeps the earliest acknowledgement across retries", async () => {
		const { requests, saveRow, advance } = build();
		await saveRow();

		expect(await requests.markRelatedPassesRequested({ userId, url })).toBe("marked");
		advance();
		await requests.markRelatedPassesRequested({ userId, url });

		expect(await requests.readRelatedPassRequestState({ userId, url })).toEqual({
			saved: true,
			requestedAt: earliest,
		});
	});

	it("reports the settled passes beside the row", async () => {
		const { requests, related, pastReads, saveRow } = build();
		await saveRow();
		await related.markRelatedArticlesSkipped({ userId, url, at: later });
		await pastReads.markPastReadsReady({ userId, url, pastReads: [], fingerprint: "f", inputTokens: 0, outputTokens: 0, at: later });

		expect(await requests.readRelatedPassRequestState({ userId, url })).toEqual({
			saved: true,
			nextRead: "skipped",
			pastReadsComputedAt: later,
		});
	});

	it("reports Next read ready with no displayed items as settled", async () => {
		const { requests, related, saveRow } = build();
		await saveRow();

		await related.markRelatedArticlesReady({ userId, url, relatedArticles: [], inputTokens: 0, outputTokens: 0, at: later });

		expect(await requests.readRelatedPassRequestState({ userId, url })).toEqual({
			saved: true,
			nextRead: "ready",
		});
	});

	it("reads and stamps the same row under any spelling of the URL", async () => {
		const { requests, saveRow } = build();
		await saveRow();

		expect(await requests.markRelatedPassesRequested({ userId, url: variantSpelling })).toBe("marked");

		expect(await requests.readRelatedPassRequestState({ userId, url })).toEqual({
			saved: true,
			requestedAt: earliest,
		});
		expect(await requests.readRelatedPassRequestState({ userId, url: variantSpelling })).toEqual({
			saved: true,
			requestedAt: earliest,
		});
	});

	it("keeps one reader's stamp and results off another reader's row of the same URL", async () => {
		const { requests, related, pastReads, saveRow } = build();
		await saveRow();
		await saveRow(secondReader);

		await requests.markRelatedPassesRequested({ userId, url });
		await related.markRelatedArticlesSkipped({ userId, url, at: later });
		await pastReads.markPastReadsReady({ userId, url, pastReads: [], fingerprint: "f", inputTokens: 0, outputTokens: 0, at: later });

		expect(await requests.readRelatedPassRequestState({ userId: secondReader, url })).toEqual({ saved: true });
	});

	it("reports Past reads computed with no Next read result", async () => {
		const { requests, pastReads, saveRow } = build();
		await saveRow();

		await pastReads.markPastReadsReady({ userId, url, pastReads: [], fingerprint: "f", inputTokens: 0, outputTokens: 0, at: later });

		expect(await requests.readRelatedPassRequestState({ userId, url })).toEqual({
			saved: true,
			pastReadsComputedAt: later,
		});
	});

	it("forgets the acknowledgement and results when the row is deleted and saved anew", async () => {
		const { store, requests, related, pastReads, saveRow } = build();
		await saveRow();
		await requests.markRelatedPassesRequested({ userId, url });
		await related.markRelatedArticlesSkipped({ userId, url, at: later });
		await pastReads.markPastReadsReady({ userId, url, pastReads: [], fingerprint: "f", inputTokens: 0, outputTokens: 0, at: later });

		const row = await store.findArticleByUrl(url);
		assert(row, "the save must leave an article row");
		await store.deleteArticle(row.id, userId);
		await saveRow();

		expect(await requests.readRelatedPassRequestState({ userId, url })).toEqual({ saved: true });
	});
});
