import type {
	SelectRelatedArticlesParams,
	SelectRelatedResult,
} from "./related-articles-selector";
import { initSelectRelatedArticlesWithoutSharedBoilerplate } from "./shared-boilerplate";

const BLOCK_PAGE_TEXT = {
	title: "Client Challenge",
	description: "A required part of this site couldn't load.",
};

function article(input: {
	title: string;
	siteName: string;
	description?: string;
}) {
	return {
		title: input.title,
		siteName: input.siteName,
		description: input.description ?? `All about ${input.title}.`,
	};
}

function candidate(input: {
	title: string;
	siteName: string;
	description?: string;
}) {
	return {
		url: `${input.siteName}/${input.title.toLowerCase().replace(/ /g, "-")}`,
		...article(input),
	};
}

function build() {
	const calls: SelectRelatedArticlesParams[] = [];
	const answer: SelectRelatedResult = {
		kind: "ready",
		related: [],
		inputTokens: 7,
		outputTokens: 3,
	};
	const { selectRelatedArticles } =
		initSelectRelatedArticlesWithoutSharedBoilerplate({
			selectRelatedArticles: async (params) => {
				calls.push(params);
				return answer;
			},
		});
	return { selectRelatedArticles, calls, answer };
}

describe("initSelectRelatedArticlesWithoutSharedBoilerplate", () => {
	it("passes a selection of unique texts through untouched", async () => {
		const { selectRelatedArticles, calls, answer } = build();
		const params: SelectRelatedArticlesParams = {
			target: article({ title: "How queues decay", siteName: "example.com" }),
			unreadCandidates: [candidate({ title: "Queue theory", siteName: "example.com" })],
			readCandidates: [candidate({ title: "Little's law", siteName: "another.com" })],
		};

		const result = await selectRelatedArticles(params);

		expect(result).toBe(answer);
		expect(calls).toEqual([params]);
	});

	it("answers shared-boilerplate for a target whose text also serves a different site", async () => {
		const { selectRelatedArticles, calls } = build();

		const result = await selectRelatedArticles({
			target: article({ siteName: "www.nature.com", ...BLOCK_PAGE_TEXT }),
			unreadCandidates: [
				candidate({ siteName: "www.slideshare.net", ...BLOCK_PAGE_TEXT }),
			],
			readCandidates: [],
		});

		expect(result).toEqual({ kind: "shared-boilerplate" });
		expect(calls).toEqual([]);
	});

	it("keeps a target whose text repeats only on its own site", async () => {
		const { selectRelatedArticles, calls } = build();

		await selectRelatedArticles({
			target: article({ siteName: "example.com", ...BLOCK_PAGE_TEXT }),
			unreadCandidates: [candidate({ siteName: "example.com", ...BLOCK_PAGE_TEXT })],
			readCandidates: [],
		});

		expect(calls).toHaveLength(1);
	});

	it("drops every copy of a text that spans two sites from both pools", async () => {
		const { selectRelatedArticles, calls } = build();

		await selectRelatedArticles({
			target: article({ title: "How queues decay", siteName: "example.com" }),
			unreadCandidates: [
				candidate({ siteName: "www.nature.com", ...BLOCK_PAGE_TEXT }),
				candidate({ title: "Queue theory", siteName: "example.com" }),
			],
			readCandidates: [
				candidate({ siteName: "www.slideshare.net", ...BLOCK_PAGE_TEXT }),
			],
		});

		const seen = calls[0];
		expect(seen?.unreadCandidates.map((entry) => entry.title)).toEqual([
			"Queue theory",
		]);
		expect(seen?.readCandidates).toEqual([]);
	});

	it("collapses whitespace and case before comparing texts", async () => {
		const { selectRelatedArticles, calls } = build();

		const result = await selectRelatedArticles({
			target: article({
				title: "  Client   Challenge ",
				siteName: "www.nature.com",
				description: "A required  part of this site couldn't load.",
			}),
			unreadCandidates: [
				candidate({ siteName: "www.slideshare.net", ...BLOCK_PAGE_TEXT }),
			],
			readCandidates: [],
		});

		expect(result).toEqual({ kind: "shared-boilerplate" });
		expect(calls).toEqual([]);
	});
});
