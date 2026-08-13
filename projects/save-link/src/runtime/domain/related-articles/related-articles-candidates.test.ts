import { UserIdSchema } from "@packages/domain/user";
import type { RelatedCandidate } from "@packages/provider-contracts/related-articles";
import { initGatherRelatedCandidatePools } from "./related-articles-candidates";
import { RELATED_CANDIDATES_MAX } from "./related-articles-limits";

const USER_ID = UserIdSchema.parse("00000000000000000000000000000001");
const TARGET_URL = "https://example.com/target";

function pool(prefix: string, count: number): RelatedCandidate[] {
	return Array.from({ length: count }, (_unused, index) => ({
		url: `https://example.com/${prefix}-${index}`,
		title: `${prefix} ${index}`,
		siteName: "Example",
		description: "",
	}));
}

interface AskedFor {
	userId: string;
	excludeUrl: string;
	limit: number;
}

function build(sizes: {
	unread: number;
	read: number;
	unreadAwaitingCrawl?: number;
	readAwaitingCrawl?: number;
}) {
	const unreadAsks: AskedFor[] = [];
	const readAsks: AskedFor[] = [];
	const { gatherRelatedCandidatePools } = initGatherRelatedCandidatePools({
		findRelatedCandidateArticles: async (params) => {
			unreadAsks.push(params);
			return {
				candidates: pool("unread", sizes.unread),
				awaitingCrawl: sizes.unreadAwaitingCrawl ?? 0,
			};
		},
		findRelatedReadCandidateArticles: async (params) => {
			readAsks.push(params);
			return {
				candidates: pool("read", sizes.read),
				awaitingCrawl: sizes.readAwaitingCrawl ?? 0,
			};
		},
	});
	return { gatherRelatedCandidatePools, unreadAsks, readAsks };
}

describe("initGatherRelatedCandidatePools", () => {
	it("asks the unread pool for the whole budget and the read pool for what is left", async () => {
		const { gatherRelatedCandidatePools, unreadAsks, readAsks } = build({
			unread: 940,
			read: 60,
		});

		const pools = await gatherRelatedCandidatePools({
			userId: USER_ID,
			excludeUrl: TARGET_URL,
		});

		expect(unreadAsks).toEqual([
			{ userId: USER_ID, excludeUrl: TARGET_URL, limit: RELATED_CANDIDATES_MAX },
		]);
		expect(readAsks).toEqual([
			{ userId: USER_ID, excludeUrl: TARGET_URL, limit: 60 },
		]);
		expect({
			unread: pools.unreadCandidates.length,
			read: pools.readCandidates.length,
		}).toEqual({ unread: 940, read: 60 });
	});

	it("spends the whole budget on past reads for a reader with nothing unread left", async () => {
		const { gatherRelatedCandidatePools, readAsks } = build({ unread: 0, read: 200 });

		const pools = await gatherRelatedCandidatePools({
			userId: USER_ID,
			excludeUrl: TARGET_URL,
		});

		expect(readAsks).toEqual([
			{ userId: USER_ID, excludeUrl: TARGET_URL, limit: RELATED_CANDIDATES_MAX },
		]);
		expect(pools.readCandidates).toHaveLength(200);
	});

	it("totals the saves both indexes held back for a crawl that has not landed", async () => {
		const { gatherRelatedCandidatePools } = build({
			unread: 10,
			read: 5,
			unreadAwaitingCrawl: 7,
			readAwaitingCrawl: 3,
		});

		const pools = await gatherRelatedCandidatePools({
			userId: USER_ID,
			excludeUrl: TARGET_URL,
		});

		expect(pools.awaitingCrawl).toBe(10);
	});

	it("reports only the unread index's held-back saves when the unread pile fills the budget", async () => {
		const { gatherRelatedCandidatePools } = build({
			unread: RELATED_CANDIDATES_MAX,
			read: 500,
			unreadAwaitingCrawl: 4,
			readAwaitingCrawl: 9,
		});

		const pools = await gatherRelatedCandidatePools({
			userId: USER_ID,
			excludeUrl: TARGET_URL,
		});

		expect(pools.awaitingCrawl).toBe(4);
	});

	it("never reads the past-reads index for a reader whose unread pile fills the budget", async () => {
		const { gatherRelatedCandidatePools, readAsks } = build({
			unread: RELATED_CANDIDATES_MAX,
			read: 500,
		});

		const pools = await gatherRelatedCandidatePools({
			userId: USER_ID,
			excludeUrl: TARGET_URL,
		});

		expect(readAsks).toEqual([]);
		expect({
			unread: pools.unreadCandidates.length,
			read: pools.readCandidates.length,
		}).toEqual({ unread: RELATED_CANDIDATES_MAX, read: 0 });
	});
});
