import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { initReadArticleContentOrThrow } from "@packages/article-store";
import {
	CandidateIdSchema,
	type Highlight,
	MinutesSchema,
	viewerFor,
} from "@packages/domain/article";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import { HighlightsReanchoredEvent } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { Logger } from "@packages/logger";
import type { ReadArticleContent } from "@packages/provider-contracts/article-store";
import type { ReadCanonicalSnapshot } from "@packages/provider-contracts/canonical-snapshot";
import type { WriteHighlightAnchor } from "@packages/provider-contracts/highlights";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initInMemoryHighlights } from "@packages/test-fixtures/providers/highlights";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import {
	HIGHLIGHTS_REANCHORED_EVENT,
	type HighlightsReanchoredLine,
} from "../observability/events";
import { initCreateReaderHighlight } from "../web/shared/article-body/highlights/create-reader-highlight";
import { prepareReaderContent } from "../web/shared/article-body/reader-slot/reader-content";
import { READER_SECTION_PAGE_THRESHOLD_BYTES } from "../web/shared/article-body/reader-slot/section-pages";
import { initReanchorHighlightsHandler } from "./reanchor-highlights-handler";

const APP_ORIGIN = "https://readplace.com";
const URL_A = "https://example.com/harbour";
const READER_ONE = UserIdSchema.parse("00000000000000000000000000000001");
const READER_TWO = UserIdSchema.parse("00000000000000000000000000000002");
const HASH_ONE = "hash-one";
const HASH_TWO = "hash-two";
const CANDIDATE_ONE = CandidateIdSchema.parse("candidate-one");
const CANDIDATE_TWO = CandidateIdSchema.parse("candidate-two");

const HARBOUR = "The harbour opened at dawn and the fishing boats slipped out past the breakwater one by one.";
const CAPTAINS = "Every captain checked the weather report twice before deciding how far to sail that morning.";
const CAPTAINS_EDITED = "Every captain checked the weather report thrice before deciding how far to sail that morning.";
const NETS = "By noon the nets were hauled aboard and the crews turned their bows toward home.";
const GULLS = "A lighthouse keeper once counted forty seven gulls perched along the old stone pier wall.";

const paragraphs = (...texts: string[]) => texts.map((text) => `<p>${text}</p>`).join("");

interface Overrides {
	readCanonicalSnapshot?: (real: ReadCanonicalSnapshot) => ReadCanonicalSnapshot;
	readArticleContent?: (real: ReadArticleContent) => ReadArticleContent;
	writeHighlightAnchor?: (real: WriteHighlightAnchor) => WriteHighlightAnchor;
}

function makeHarness(overrides: Overrides = {}) {
	const articleStore = initInMemoryArticleStore();
	const highlights = initInMemoryHighlights();
	const readArticleContent = initReadArticleContentOrThrow({
		storageProviderQueryOrder: [articleStore.readContent],
		findItemOwner: articleStore.findItemOwner,
	});
	const createReaderHighlight = initCreateReaderHighlight({
		listArticleHighlights: highlights.listArticleHighlights,
		createHighlight: highlights.createHighlight,
		newHighlightId: randomUUID,
		now: () => new Date("2026-11-01T00:00:00.000Z"),
	});
	const published: { event: unknown; detail: unknown }[] = [];
	const metricLines: HighlightsReanchoredLine[] = [];
	const infoLines: unknown[][] = [];
	const capture = (line: HighlightsReanchoredLine) => {
		metricLines.push(line);
	};
	const handler = initReanchorHighlightsHandler({
		listHighlightsOfArticle: highlights.listHighlightsOfArticle,
		readCanonicalSnapshot: (overrides.readCanonicalSnapshot ?? ((real) => real))(articleStore.readCanonicalSnapshot),
		readArticleContent: (overrides.readArticleContent ?? ((real) => real))(readArticleContent),
		writeHighlightAnchor: (overrides.writeHighlightAnchor ?? ((real) => real))(highlights.writeHighlightAnchor),
		publishEvent: (async (event, detail) => {
			published.push({ event, detail });
		}) as PublishEvent,
		appOrigin: APP_ORIGIN,
		metricLog: { info: capture, error: capture, warn: capture, debug: capture },
		logger: Logger.from({
			info: (...args: unknown[]) => {
				infoLines.push(args);
			},
			error: () => {},
			warn: () => {},
			debug: () => {},
		}),
	});

	const readerText = async (url: string): Promise<string> => {
		const stored = await readArticleContent({ url, viewer: viewerFor(READER_ONE) });
		assert(stored.kind === "article");
		return prepareReaderContent({
			content: stored.body,
			appOrigin: APP_ORIGIN,
			url,
			section: { requested: undefined, readerPath: "", thresholdBytes: READER_SECTION_PAGE_THRESHOLD_BYTES },
		}).text;
	};

	const seedArticle = async (params: { url: string; html: string; hash?: string; candidateId?: typeof CANDIDATE_ONE }) => {
		await articleStore.saveArticle({
			userId: READER_ONE,
			url: params.url,
			metadata: { title: "Harbour", siteName: "example.com", excerpt: "An excerpt", wordCount: 100 },
			estimatedReadTime: MinutesSchema.parse(2),
			provenance: { kind: "web" },
			savedAt: new Date("2026-11-01T00:00:00.000Z"),
		});
		if (params.hash === undefined) return;
		await articleStore.replaceCanonicalContent({
			url: params.url,
			content: params.html,
			canonicalContentHash: params.hash,
			canonicalCandidateId: params.candidateId ?? CANDIDATE_ONE,
		});
	};

	const highlight = async (params: { url: string; userId: UserId; exact: string; text?: string; hash?: string }): Promise<Highlight> => {
		const text = params.text ?? (await readerText(params.url));
		const start = text.indexOf(params.exact);
		assert(start >= 0, `"${params.exact}" is in the seeded text`);
		const outcome = await createReaderHighlight({
			text,
			contentHash: params.hash ?? HASH_ONE,
			userId: params.userId,
			url: ArticleResourceUniqueId.parse(params.url).value,
			exact: params.exact,
			start,
			end: start + params.exact.length,
		});
		assert(outcome.status === "created");
		return outcome.highlight;
	};

	const rowsOf = async (url: string) => highlights.listHighlightsOfArticle(url);

	const rowOf = async (params: { url: string; highlightId: string }) => {
		const row = (await rowsOf(params.url)).find((candidate) => candidate.highlight.highlightId === params.highlightId);
		assert(row, `row ${params.highlightId} is stored`);
		return row.highlight;
	};

	const run = async (params: { url?: string; body?: string } = {}) => {
		const body = params.body ?? JSON.stringify({ detail: { url: params.url ?? URL_A } });
		const response = await handler(buildSqsEvent([{ messageId: "msg-1", body }]), buildLambdaContext(), () => {});
		assert(response, "the handler always returns a batch response");
		return response;
	};

	return { articleStore, highlights, seedArticle, highlight, readerText, rowsOf, rowOf, run, published, metricLines, infoLines };
}

describe("initReanchorHighlightsHandler", () => {
	it("moves an edited passage, orphans a deleted one, keeps another reader's anchored, and reports the counts", async () => {
		const h = makeHarness();
		await h.seedArticle({ url: URL_A, html: paragraphs(HARBOUR, CAPTAINS, NETS, GULLS), hash: HASH_ONE });
		const edited = await h.highlight({ url: URL_A, userId: READER_ONE, exact: "checked the weather report twice before deciding how far to sail that" });
		const deleted = await h.highlight({ url: URL_A, userId: READER_ONE, exact: "counted forty seven gulls perched along the old stone pier wall" });
		const kept = await h.highlight({ url: URL_A, userId: READER_TWO, exact: "the fishing boats slipped out past the breakwater" });
		await h.articleStore.replaceCanonicalContent({
			url: URL_A,
			content: paragraphs(HARBOUR, CAPTAINS_EDITED, NETS),
			canonicalContentHash: HASH_TWO,
			canonicalCandidateId: CANDIDATE_TWO,
		});

		const response = await h.run();

		assert.deepEqual(response.batchItemFailures, []);
		const text = await h.readerText(URL_A);
		const moved = await h.rowOf({ url: URL_A, highlightId: edited.highlightId });
		assert.equal(moved.anchorState, "moved");
		assert.equal(text.slice(moved.start, moved.end), "checked the weather report thrice before deciding how far to sail that");
		assert.equal(moved.orderKey, moved.start);
		const orphaned = await h.rowOf({ url: URL_A, highlightId: deleted.highlightId });
		assert.equal(orphaned.anchorState, "orphaned");
		assert.equal(orphaned.orderKey, deleted.orderKey);
		const anchored = await h.rowOf({ url: URL_A, highlightId: kept.highlightId });
		assert.equal(anchored.anchorState, "anchored");
		assert.equal(text.slice(anchored.start, anchored.end), kept.exact);
		for (const row of [moved, orphaned, anchored]) {
			assert.equal(row.anchoredContentHash, HASH_TWO);
			assert.equal(row.anchoredCandidateId, CANDIDATE_TWO);
			assert.equal(row.anchorRevision, edited.anchorRevision + 1);
		}
		assert.deepEqual(h.published, [
			{ event: HighlightsReanchoredEvent, detail: { url: URL_A, anchored: 1, moved: 1, orphaned: 1 } },
		]);
		assert.deepEqual(h.metricLines, [
			{ event: HIGHLIGHTS_REANCHORED_EVENT, url: URL_A, anchored: 1, moved: 1, orphaned: 1, skipped: 0 },
		]);
	});

	it("re-anchors rows onto the new candidate when a tier flip keeps the hash", async () => {
		const h = makeHarness();
		await h.seedArticle({ url: URL_A, html: paragraphs(HARBOUR, CAPTAINS), hash: HASH_ONE });
		const seeded = await h.highlight({ url: URL_A, userId: READER_ONE, exact: "the fishing boats slipped out" });
		await h.articleStore.replaceCanonicalContent({
			url: URL_A,
			content: paragraphs(HARBOUR, CAPTAINS),
			canonicalContentHash: HASH_ONE,
			canonicalCandidateId: CANDIDATE_TWO,
		});

		const response = await h.run();

		assert.deepEqual(response.batchItemFailures, []);
		const row = await h.rowOf({ url: URL_A, highlightId: seeded.highlightId });
		assert.equal(row.anchoredCandidateId, CANDIDATE_TWO);
		assert.equal(row.anchorState, "anchored");
		assert.equal(row.anchorRevision, seeded.anchorRevision + 1);
		assert.deepEqual(h.published, [
			{ event: HighlightsReanchoredEvent, detail: { url: URL_A, anchored: 1, moved: 0, orphaned: 0 } },
		]);
	});

	it("writes the offsets the reader marks when the body holds a table", async () => {
		const h = makeHarness();
		const table = "<table><tr><th>Boat</th><td>Catch</td></tr><tr><th>Gull</th><td>Herring</td></tr></table>";
		await h.seedArticle({ url: URL_A, html: `${table}${paragraphs(HARBOUR)}`, hash: HASH_ONE });
		const seeded = await h.highlight({ url: URL_A, userId: READER_ONE, exact: "slipped out past the breakwater" });
		const html = `${paragraphs(GULLS)}${table}${paragraphs(HARBOUR)}`;
		await h.articleStore.replaceCanonicalContent({
			url: URL_A,
			content: html,
			canonicalContentHash: HASH_TWO,
			canonicalCandidateId: CANDIDATE_TWO,
		});

		await h.run();

		const row = await h.rowOf({ url: URL_A, highlightId: seeded.highlightId });
		const stored = await initReadArticleContentOrThrow({
			storageProviderQueryOrder: [h.articleStore.readContent],
			findItemOwner: h.articleStore.findItemOwner,
		})({ url: URL_A, viewer: viewerFor(READER_ONE) });
		assert(stored.kind === "article");
		const rendered = prepareReaderContent({
			content: stored.body,
			appOrigin: APP_ORIGIN,
			url: URL_A,
			section: { requested: undefined, readerPath: "/queue/a/view", thresholdBytes: READER_SECTION_PAGE_THRESHOLD_BYTES },
			highlights: { rows: [row], canonicalContentHash: HASH_TWO },
		});
		const [state] = rendered.states;
		assert.equal(state.anchor.start, row.start);
		assert.equal(state.anchor.end, row.end);
		assert.equal(rendered.text.slice(row.start, row.end), seeded.exact);
		assert.ok(row.start > seeded.start);
	});

	it("finds the rows when the event URL is one the parser normalises", async () => {
		const h = makeHarness();
		await h.seedArticle({ url: URL_A, html: paragraphs(HARBOUR), hash: HASH_ONE });
		const seeded = await h.highlight({ url: URL_A, userId: READER_ONE, exact: "the fishing boats" });
		await h.articleStore.replaceCanonicalContent({
			url: URL_A,
			content: paragraphs(GULLS, HARBOUR),
			canonicalContentHash: HASH_TWO,
			canonicalCandidateId: CANDIDATE_TWO,
		});

		const response = await h.run({ url: `${URL_A}?utm_source=newsletter` });

		assert.deepEqual(response.batchItemFailures, []);
		const row = await h.rowOf({ url: URL_A, highlightId: seeded.highlightId });
		assert.equal(row.anchoredContentHash, HASH_TWO);
		assert.equal(row.anchorRevision, seeded.anchorRevision + 1);
	});

	it("returns without publishing when the article has no highlights", async () => {
		const h = makeHarness();
		await h.seedArticle({ url: URL_A, html: paragraphs(HARBOUR), hash: HASH_ONE });

		const response = await h.run();

		assert.deepEqual(response.batchItemFailures, []);
		assert.deepEqual(h.published, []);
		assert.deepEqual(h.metricLines, []);
	});

	it("leaves a webmail URL's rows as they are", async () => {
		const h = makeHarness();
		const webmail = "https://mail.google.com/mail/u/0/";
		await h.seedArticle({ url: webmail, html: paragraphs(HARBOUR), hash: HASH_ONE });
		await h.highlight({ url: webmail, userId: READER_ONE, exact: "the fishing boats", text: HARBOUR });
		await h.articleStore.replaceCanonicalContent({
			url: webmail,
			content: paragraphs(GULLS, HARBOUR),
			canonicalContentHash: HASH_TWO,
			canonicalCandidateId: CANDIDATE_TWO,
		});
		const seeded = await h.rowsOf(webmail);

		const response = await h.run({ url: webmail });

		assert.deepEqual(response.batchItemFailures, []);
		assert.deepEqual(await h.rowsOf(webmail), seeded);
		assert.deepEqual(h.published, []);
		assert.deepEqual(h.metricLines, []);
	});

	it("skips a body with no canonical snapshot with one log line naming the url", async () => {
		const h = makeHarness();
		await h.seedArticle({ url: URL_A, html: paragraphs(HARBOUR) });
		await h.highlight({ url: URL_A, userId: READER_ONE, exact: "the fishing boats", text: HARBOUR });
		const seeded = await h.rowsOf(URL_A);

		const response = await h.run();

		assert.deepEqual(response.batchItemFailures, []);
		assert.deepEqual(await h.rowsOf(URL_A), seeded);
		assert.deepEqual(h.infoLines, [["[reanchor-highlights] no canonical snapshot, skipped", { url: URL_A }]]);
		assert.deepEqual(h.metricLines, []);
		assert.deepEqual(h.published, []);
	});

	it("fails the record when the snapshot names a body that is missing", async () => {
		const h = makeHarness();
		await h.seedArticle({ url: URL_A, html: paragraphs(HARBOUR), hash: HASH_ONE });
		await h.highlight({ url: URL_A, userId: READER_ONE, exact: "the fishing boats" });
		await h.articleStore.replaceCanonicalContent({
			url: URL_A,
			content: "",
			canonicalContentHash: HASH_TWO,
			canonicalCandidateId: CANDIDATE_TWO,
		});
		const seeded = await h.rowsOf(URL_A);

		const response = await h.run();

		assert.deepEqual(response.batchItemFailures, [{ itemIdentifier: "msg-1" }]);
		assert.deepEqual(await h.rowsOf(URL_A), seeded);
		assert.deepEqual(h.published, []);
	});

	it("fails the record when the content reader rejects", async () => {
		const h = makeHarness({
			readArticleContent: () => async () => {
				throw new Error("S3 throttled");
			},
		});
		await h.seedArticle({ url: URL_A, html: paragraphs(HARBOUR), hash: HASH_ONE });
		await h.highlight({ url: URL_A, userId: READER_ONE, exact: "the fishing boats", text: HARBOUR });
		const seeded = await h.rowsOf(URL_A);

		const response = await h.run();

		assert.deepEqual(response.batchItemFailures, [{ itemIdentifier: "msg-1" }]);
		assert.deepEqual(await h.rowsOf(URL_A), seeded);
	});

	const changingSnapshots: [string, (real: ReadCanonicalSnapshot) => ReadCanonicalSnapshot][] = [
		[
			"the hash",
			(real) => {
				let reads = 0;
				return async (url) => {
					const snapshot = await real(url);
					reads++;
					return reads === 1 || snapshot === undefined ? snapshot : { ...snapshot, canonicalContentHash: "hash-three" };
				};
			},
		],
		[
			"the candidate",
			(real) => {
				let reads = 0;
				return async (url) => {
					const snapshot = await real(url);
					reads++;
					return reads === 1 || snapshot === undefined
						? snapshot
						: { ...snapshot, canonicalCandidateId: CandidateIdSchema.parse("candidate-three") };
				};
			},
		],
		[
			"the snapshot's presence",
			(real) => {
				let reads = 0;
				return async (url) => {
					reads++;
					return reads === 1 ? real(url) : undefined;
				};
			},
		],
	];

	it.each(changingSnapshots)("fails the record when %s changes between the two snapshot reads", async (_label, readCanonicalSnapshot) => {
		const h = makeHarness({ readCanonicalSnapshot });
		await h.seedArticle({ url: URL_A, html: paragraphs(HARBOUR), hash: HASH_ONE });
		await h.highlight({ url: URL_A, userId: READER_ONE, exact: "the fishing boats" });
		const seeded = await h.rowsOf(URL_A);

		const response = await h.run();

		assert.deepEqual(response.batchItemFailures, [{ itemIdentifier: "msg-1" }]);
		assert.deepEqual(await h.rowsOf(URL_A), seeded);
	});

	it("counts a row deleted before its write as skipped", async () => {
		let deleteFirst: (() => Promise<void>) | undefined;
		const h = makeHarness({
			writeHighlightAnchor: (real) => async (params) => {
				await deleteFirst?.();
				return real(params);
			},
		});
		await h.seedArticle({ url: URL_A, html: paragraphs(HARBOUR), hash: HASH_ONE });
		const seeded = await h.highlight({ url: URL_A, userId: READER_ONE, exact: "the fishing boats" });
		deleteFirst = async () => {
			await h.highlights.deleteHighlight({ userId: READER_ONE, url: seeded.highlightOf, highlightId: seeded.highlightId });
		};
		await h.articleStore.replaceCanonicalContent({
			url: URL_A,
			content: paragraphs(GULLS, HARBOUR),
			canonicalContentHash: HASH_TWO,
			canonicalCandidateId: CANDIDATE_TWO,
		});

		const response = await h.run();

		assert.deepEqual(response.batchItemFailures, []);
		assert.deepEqual(h.metricLines, [
			{ event: HIGHLIGHTS_REANCHORED_EVENT, url: URL_A, anchored: 0, moved: 0, orphaned: 0, skipped: 1 },
		]);
		assert.deepEqual(h.published, [
			{ event: HighlightsReanchoredEvent, detail: { url: URL_A, anchored: 0, moved: 0, orphaned: 0 } },
		]);
	});

	it("fails the record when an older run wins the write, and the redelivery anchors on the new text", async () => {
		let raceOnce: (() => void) | undefined;
		const h = makeHarness({
			writeHighlightAnchor: (real) => async (params) => {
				raceOnce?.();
				raceOnce = undefined;
				return real(params);
			},
		});
		await h.seedArticle({ url: URL_A, html: paragraphs(HARBOUR), hash: HASH_ONE });
		const seeded = await h.highlight({ url: URL_A, userId: READER_ONE, exact: "the fishing boats" });
		raceOnce = () =>
			h.highlights.bumpAnchorRevision({ userId: READER_ONE, url: seeded.highlightOf, highlightId: seeded.highlightId });
		await h.articleStore.replaceCanonicalContent({
			url: URL_A,
			content: paragraphs(GULLS, HARBOUR),
			canonicalContentHash: HASH_TWO,
			canonicalCandidateId: CANDIDATE_TWO,
		});

		const first = await h.run();

		assert.deepEqual(first.batchItemFailures, [{ itemIdentifier: "msg-1" }]);
		assert.deepEqual(h.published, []);

		const redelivered = await h.run();

		assert.deepEqual(redelivered.batchItemFailures, []);
		const row = await h.rowOf({ url: URL_A, highlightId: seeded.highlightId });
		assert.equal(row.anchoredContentHash, HASH_TWO);
		assert.equal(row.anchorRevision, seeded.anchorRevision + 2);
		assert.equal((await h.readerText(URL_A)).slice(row.start, row.end), seeded.exact);
	});

	it("fails a record whose detail is malformed", async () => {
		const h = makeHarness();

		const response = await h.run({ body: JSON.stringify({ detail: {} }) });

		assert.deepEqual(response.batchItemFailures, [{ itemIdentifier: "msg-1" }]);
	});
});
