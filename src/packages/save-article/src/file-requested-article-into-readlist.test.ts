import assert from "node:assert/strict";
import {
	ANONYMOUS_VIEWER,
	articleDestinationUrl,
	articleDisplayMetadata,
	MinutesSchema,
	ReaderArticleHashId,
} from "@packages/domain/article";
import type { SavedArticle, SaveProvenance } from "@packages/domain/article";
import { formatEmailLinkOrdinal } from "@packages/domain/inbox";
import { ReadlistFitOverrideIdSchema, ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import type {
	FileIntoLiveReadlistOutcome,
	FindReadlistFiling,
	ReadlistFilingLandsAs,
	ReadlistFitOverride,
} from "@packages/provider-contracts/article-store";
import { initFileRequestedArticleIntoReadlist } from "./file-requested-article-into-readlist";

const USER = UserIdSchema.parse("user-a");
const WORK = ReadlistSlugSchema.parse("work");
const URL = "https://example.com/article";
const DESTINATION = articleDestinationUrl({ url: URL, displayUrl: undefined });
const PROVENANCE: SaveProvenance = { kind: "email", senderEmail: "news@example.com" };
const REQUESTED_AT = new Date("2026-11-03T10:00:00Z");
const EARLIER = new Date("2026-11-03T09:00:00Z");
const LATER_SECOND = new Date("2026-11-03T10:00:01Z");
const SAME_SECOND = new Date("2026-11-03T10:00:00.600Z");
const ORDINAL = formatEmailLinkOrdinal(3);
const EMAIL_SOURCE = { kind: "email" as const, receivedAtMessageId: "2026-11-03#<m@x>", ordinal: ORDINAL };

function articleWith(overrides: Partial<SavedArticle> = {}): SavedArticle {
	return {
		id: ReaderArticleHashId.from(URL),
		userId: USER,
		url: URL,
		destinationUrl: DESTINATION,
		metadata: articleDisplayMetadata({ url: URL, destinationUrl: DESTINATION, title: "T", siteName: "S", excerpt: "E", wordCount: 1, imageUrl: undefined, publishedOn: undefined, viewer: ANONYMOUS_VIEWER, ownerUserId: undefined }),
		servedBody: { kind: "legacy" },
		estimatedReadTime: MinutesSchema.parse(1),
		status: "unread",
		savedAt: EARLIER,
		...overrides,
	};
}

function override(overrides: Partial<ReadlistFitOverride> = {}): ReadlistFitOverride {
	return {
		id: ReadlistFitOverrideIdSchema.parse("1762164000000000-x-0003"),
		url: URL,
		anchorText: "A",
		host: "example.com",
		readerVerdict: "drop",
		receivedAtMessageId: "2026-11-02#<other@x>",
		ordinal: formatEmailLinkOrdinal(9),
		createdAt: LATER_SECOND,
		...overrides,
	};
}

function harness(opts: {
	row?: Awaited<ReturnType<FindReadlistFiling>>;
	outcome?: FileIntoLiveReadlistOutcome;
	overrides?: ReadlistFitOverride[];
	resolve?: (url: string) => string;
}) {
	const landed: ReadlistFilingLandsAs[] = [];
	const resurfaced: unknown[] = [];
	const file = initFileRequestedArticleIntoReadlist({
		listReadlistFitOverrides: async () => opts.overrides ?? [],
		resolveCanonicalIdentity: async (url) => (opts.resolve ?? ((u) => u))(url),
		findReadlistFiling: async () => opts.row,
		fileIntoLiveReadlist: async (params) => {
			assert(opts.outcome, "the transaction must not run");
			landed.push(params.landsAs);
			return { outcome: opts.outcome };
		},
		allocateSavedAt: async () => {
			assert(opts.outcome, "no savedAt is allocated without a transaction");
			return new Date("2026-11-03T10:05:00Z");
		},
		updateArticleStatusAcrossReadlists: async (params) => {
			resurfaced.push(params);
			return null;
		},
	});
	const run = (article: SavedArticle, source: Parameters<typeof file>[0]["source"] = EMAIL_SOURCE) =>
		file({ userId: USER, readlist: WORK, article, provenance: PROVENANCE, source, requestedAt: REQUESTED_AT });
	return { run, landed, resurfaced };
}

describe("initFileRequestedArticleIntoReadlist", () => {
	it.each([
		["the All row is unread", articleWith(), { status: "unread" }],
		["the All row was read before the request", articleWith({ status: "read", readAt: EARLIER }), { status: "unread" }],
		["the All row is read with no read time", articleWith({ status: "read" }), { status: "unread" }],
		["the All row was read in a later second", articleWith({ status: "read", readAt: LATER_SECOND }), { status: "read", readAt: LATER_SECOND }],
		["the All row was read in the request's second", articleWith({ status: "read", readAt: SAME_SECOND }), { status: "read", readAt: SAME_SECOND }],
	])("files an absent row when %s, landing it as the All row's read allows", async (_name, article, landsAs) => {
		const h = harness({ outcome: "filed" });

		expect(await h.run(article)).toEqual({ kind: "filed" });
		expect(h.landed).toEqual([landsAs]);
		expect(h.resurfaced).toEqual([]);
	});

	it("answers filed when a row appeared read since the read, and resurfaces nothing", async () => {
		const h = harness({ outcome: "newer-row-won" });

		expect(await h.run(articleWith({ status: "read", readAt: LATER_SECOND }))).toEqual({ kind: "filed" });
		expect(h.resurfaced).toEqual([]);
	});

	it.each([
		["read in an earlier second", { savedAt: EARLIER, status: "read" as const, readAt: EARLIER }],
		["read in the request's second", { savedAt: EARLIER, status: "read" as const, readAt: SAME_SECOND }],
	])("resurfaces an older readlist row %s that the filing moved", async (_name, row) => {
		const h = harness({ row, outcome: "filed" });

		expect(await h.run(articleWith())).toEqual({ kind: "filed" });
		expect(h.resurfaced).toEqual([{ id: ReaderArticleHashId.from(URL), userId: USER, addressed: WORK, status: "unread" }]);
	});

	it.each([
		["an older unread row that the filing moved", { savedAt: EARLIER, status: "unread" as const }, "filed" as const],
		["an older read row a newer write took", { savedAt: EARLIER, status: "read" as const, readAt: EARLIER }, "newer-row-won" as const],
	])("does not resurface %s", async (_name, row, outcome) => {
		const h = harness({ row, outcome });

		expect(await h.run(articleWith())).toEqual({ kind: "filed" });
		expect(h.resurfaced).toEqual([]);
	});

	it.each([
		["read in a later second", { savedAt: EARLIER, status: "read" as const, readAt: LATER_SECOND }],
		["saved at or after the request and read before it", { savedAt: REQUESTED_AT, status: "read" as const, readAt: EARLIER }],
		["saved after the request and unread", { savedAt: LATER_SECOND, status: "unread" as const }],
	])("leaves a readlist row %s in place without a write", async (_name, row) => {
		const h = harness({ row });

		expect(await h.run(articleWith())).toEqual({ kind: "filed" });
		expect(h.resurfaced).toEqual([]);
	});

	it.each([
		["readlist-gone", { kind: "skipped", reason: "readlist-gone" }],
		["removed-after-request", { kind: "skipped", reason: "removed-after-request" }],
		["not-in-all", { kind: "not-in-all" }],
	] as const)("maps %s from the transaction", async (outcome, result) => {
		const h = harness({ row: { savedAt: EARLIER, status: "read", readAt: EARLIER }, outcome });

		expect(await h.run(articleWith())).toEqual(result);
		expect(h.resurfaced).toEqual([]);
	});

	it.each([
		["a newer drop whose URL resolves to the article", { url: "https://alias.example.com/a" }, EMAIL_SOURCE],
		["a newer drop of a reader filing whose URL resolves to the article", { url: "https://alias.example.com/a" }, { kind: "reader" as const }],
		["a newer drop matching by email id and ordinal", { url: "https://elsewhere.example.com/b", receivedAtMessageId: EMAIL_SOURCE.receivedAtMessageId, ordinal: ORDINAL }, EMAIL_SOURCE],
	])("skips %s before reading the readlist row", async (_name, fields, source) => {
		const h = harness({
			overrides: [override(fields)],
			resolve: (url) => (url === "https://alias.example.com/a" ? URL : url),
		});

		expect(await h.run(articleWith(), source)).toEqual({ kind: "skipped", reason: "reader-dropped" });
	});

	it.each([
		["a drop in the request's second", override({ createdAt: SAME_SECOND })],
		["a newer keep", override({ readerVerdict: "keep" })],
		["a newer drop of another article", override({ url: "https://example.com/other" })],
		["a newer drop whose URL is not saveable", override({ url: "not a url" })],
		["a newer drop sharing the email id under another ordinal", override({ url: "https://example.com/other", receivedAtMessageId: EMAIL_SOURCE.receivedAtMessageId })],
	])("goes on to the transaction past %s", async (_name, entry) => {
		const h = harness({ overrides: [entry], outcome: "filed" });

		expect(await h.run(articleWith())).toEqual({ kind: "filed" });
		expect(h.landed).toHaveLength(1);
	});
});
