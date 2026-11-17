import assert from "node:assert/strict";
import { validateSaveableUrl, withPrivateItemRefusal } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initClaimViewHighlights } from "./claim-view-highlights";

const READER = UserIdSchema.parse("reader-1");
const ARTICLE_URL = "https://example.com/post";
const PRIVATE_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";

function claimWith(input: { unresolved: boolean }) {
	const refreshed: string[] = [];
	const claim = initClaimViewHighlights({
		validateNewSaveUrl: withPrivateItemRefusal(validateSaveableUrl),
		refreshArticleIfStale: async ({ url }) => {
			refreshed.push(url);
			assert.equal(input.unresolved, true, "only the unresolved case reaches a save");
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

describe("initClaimViewHighlights", () => {
	it("drops the highlights of a link a reader may not save", async () => {
		const { claim, refreshed } = claimWith({ unresolved: false });

		const claimed = await claim({
			userId: READER,
			provenance: { kind: "web" },
			pending: { articleUrl: PRIVATE_URL, items: [{ url: PRIVATE_URL, exact: "Quote", prefix: "", suffix: "" }], returnTo: undefined },
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
