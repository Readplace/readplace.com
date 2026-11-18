import assert from "node:assert/strict";
import {
	ANONYMOUS_VIEWER,
	articleDestinationUrl,
	articleDisplayMetadata,
	type Highlight,
	HighlightIdSchema,
	MinutesSchema,
	ReaderArticleHashIdSchema,
	SaveableUrlSchema,
	type SavedArticle,
	validateSaveableUrl,
	withPrivateItemRefusal,
} from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import type { CreateHighlightByQuoteOutcome } from "../../shared/article-body/highlights/create-highlight-by-quote";
import { initClaimViewHighlights } from "./claim-view-highlights";

const READER = UserIdSchema.parse("reader-1");
const ARTICLE_URL = "https://example.com/post";
const PRIVATE_URL =
	"https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";

function claimWith(input: { unresolved: boolean }) {
	const refreshed: string[] = [];
	const claim = initClaimViewHighlights({
		validateNewSaveUrl: withPrivateItemRefusal(validateSaveableUrl),
		refreshArticleIfStale: async ({ url }) => {
			refreshed.push(url);
			assert.equal(
				input.unresolved,
				true,
				"only the unresolved case reaches a save",
			);
			return { action: "unresolved", identity: { status: "unresolved" } };
		},
		saveArticleAtReadlistTop: async () => {
			throw new Error("an unsaveable link is never saved");
		},
		createHighlightByQuote: async () => {
			throw new Error("no highlight is created on an unsaved article");
		},
	});
	return { claim, refreshed };
}

function claimAnswering(outcome: CreateHighlightByQuoteOutcome) {
	const url = SaveableUrlSchema.parse(ARTICLE_URL);
	const destinationUrl = articleDestinationUrl({ url, displayUrl: undefined });
	const saved: SavedArticle = {
		id: ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef"),
		userId: READER,
		url,
		destinationUrl,
		metadata: articleDisplayMetadata({
			url,
			destinationUrl,
			title: "Post",
			siteName: "Example",
			excerpt: "",
			wordCount: 0,
			imageUrl: undefined,
			publishedOn: undefined,
			viewer: ANONYMOUS_VIEWER,
			ownerUserId: undefined,
		}),
		servedBody: { kind: "legacy" },
		estimatedReadTime: MinutesSchema.parse(0),
		status: "unread",
		savedAt: new Date("2026-11-18T00:00:00.000Z"),
	};
	return initClaimViewHighlights({
		validateNewSaveUrl: withPrivateItemRefusal(validateSaveableUrl),
		refreshArticleIfStale: async () => ({
			action: "skip",
			identity: { status: "resolved", url, originalUrl: url },
		}),
		saveArticleAtReadlistTop: async () => ({
			saved,
			canonicalUrl: ARTICLE_URL,
			createdUserArticle: true,
			wroteUserArticle: true,
			resurfacedFromRead: false,
			meteredLegs: "run",
			crawlPending: { kind: "not-attempted" },
		}),
		createHighlightByQuote: async () => outcome,
	});
}

const EXISTING: Highlight = {
	highlightId: HighlightIdSchema.parse("0b8f6c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e"),
	highlightOf: "0123456789abcdef0123456789abcdef",
	exact: "A longer passage that holds the quote",
	prefix: "",
	suffix: "",
	start: 0,
	end: 37,
	anchoredContentHash: "hash",
	anchorState: "anchored",
	orderKey: 0,
	createdAt: new Date("2026-11-17T00:00:00.000Z"),
	updatedAt: new Date("2026-11-17T00:00:00.000Z"),
	anchorRevision: 0,
};

describe("initClaimViewHighlights", () => {
	it.each([
		{ outcome: { status: "unchanged", highlight: EXISTING } },
		{
			outcome: {
				status: "noted",
				highlight: { ...EXISTING, note: "Kept note" },
			},
		},
	] satisfies {
		outcome: CreateHighlightByQuoteOutcome;
	}[])("keeps a passage already inside a highlight on the account ($outcome.status)", async ({
		outcome,
	}) => {
		const claim = claimAnswering(outcome);

		const claimed = await claim({
			userId: READER,
			provenance: { kind: "web" },
			pending: {
				articleUrl: ARTICLE_URL,
				returnTo: undefined,
				items: [
					{
						url: ARTICLE_URL,
						exact: "the quote",
						note: "Kept note",
						prefix: "",
						suffix: "",
					},
				],
			},
		});

		assert.equal(claimed.created, 1);
		assert.equal(claimed.dropped, 0);
	});

	it("drops the highlights of a link a reader may not save", async () => {
		const { claim, refreshed } = claimWith({ unresolved: false });

		const claimed = await claim({
			userId: READER,
			provenance: { kind: "web" },
			pending: {
				articleUrl: PRIVATE_URL,
				items: [{ url: PRIVATE_URL, exact: "Quote", prefix: "", suffix: "" }],
				returnTo: undefined,
			},
		});

		assert.deepEqual(claimed, { articleId: undefined, created: 0, dropped: 1 });
		assert.deepEqual(refreshed, []);
	});

	it("drops the highlights of a link whose article cannot be resolved yet", async () => {
		const { claim, refreshed } = claimWith({ unresolved: true });

		const claimed = await claim({
			userId: READER,
			provenance: { kind: "web" },
			pending: {
				articleUrl: ARTICLE_URL,
				returnTo: undefined,
				items: [
					{ url: ARTICLE_URL, exact: "First", prefix: "", suffix: "" },
					{ url: ARTICLE_URL, exact: "Second", prefix: "", suffix: "" },
				],
			},
		});

		assert.deepEqual(claimed, { articleId: undefined, created: 0, dropped: 2 });
		assert.deepEqual(refreshed, [ARTICLE_URL]);
	});
});
