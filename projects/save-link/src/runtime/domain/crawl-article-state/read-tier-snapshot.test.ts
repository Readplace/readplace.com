import {
	initReadTierSnapshot,
	type CheckTier0SourceExists,
	type ReadArticleCrawlState,
} from "./read-tier-snapshot";

function buildDeps(overrides: {
	tier0SourceExists?: boolean;
	crawlStatus?: "ready" | "failed" | "pending" | "absent";
	canonicalSourceTier?: "tier-0" | "tier-1" | "none";
}) {
	const checkTier0SourceExists: CheckTier0SourceExists = async () => overrides.tier0SourceExists ?? false;
	const readArticleCrawlState: ReadArticleCrawlState = async () => ({
		crawlStatus: overrides.crawlStatus ?? "absent",
		canonicalSourceTier: overrides.canonicalSourceTier ?? "none",
	});
	return { checkTier0SourceExists, readArticleCrawlState };
}

describe("readTierSnapshot", () => {
	it("reports both tiers as not_attempted when nothing has run", async () => {
		const { readTierSnapshot } = initReadTierSnapshot(buildDeps({}));

		const snapshot = await readTierSnapshot({ url: "https://example.com/a" });

		expect(snapshot).toEqual({
			tier0Status: "not_attempted",
			tier1Status: "not_attempted",
			pickedTier: "none",
		});
	});

	it("reports tier-0 success and tier-1 not_attempted while tier-1 is still in flight", async () => {
		const { readTierSnapshot } = initReadTierSnapshot(buildDeps({
			tier0SourceExists: true,
			crawlStatus: "pending",
			canonicalSourceTier: "tier-0",
		}));

		const snapshot = await readTierSnapshot({ url: "https://example.com/b" });

		expect(snapshot).toEqual({
			tier0Status: "success",
			tier1Status: "not_attempted",
			pickedTier: "tier-0",
		});
	});

	it("reports tier-1 success and tier-0 not_attempted when only tier-1 ran", async () => {
		const { readTierSnapshot } = initReadTierSnapshot(buildDeps({
			tier0SourceExists: false,
			crawlStatus: "ready",
			canonicalSourceTier: "tier-1",
		}));

		const snapshot = await readTierSnapshot({ url: "https://example.com/c" });

		expect(snapshot).toEqual({
			tier0Status: "not_attempted",
			tier1Status: "success",
			pickedTier: "tier-1",
		});
	});

	it("reports tier-1 failed (not collapsed to not_attempted) so the other tier's outcome can flag a real failure", async () => {
		const { readTierSnapshot } = initReadTierSnapshot(buildDeps({
			tier0SourceExists: false,
			crawlStatus: "failed",
			canonicalSourceTier: "none",
		}));

		const snapshot = await readTierSnapshot({ url: "https://example.com/f" });

		expect(snapshot).toEqual({
			tier0Status: "not_attempted",
			tier1Status: "failed",
			pickedTier: "none",
		});
	});

	it("reports both tiers with tier-0 picked when the Deepseek selector promoted tier-0 over a prior tier-1 canonical", async () => {
		const { readTierSnapshot } = initReadTierSnapshot(buildDeps({
			tier0SourceExists: true,
			crawlStatus: "ready",
			canonicalSourceTier: "tier-0",
		}));

		const snapshot = await readTierSnapshot({ url: "https://example.com/d" });

		expect(snapshot).toEqual({
			tier0Status: "success",
			tier1Status: "success",
			pickedTier: "tier-0",
		});
	});

	it("reports both tiers with tier-1 picked when tier-1 overwrote the canonical after tier-0 stored its source", async () => {
		const { readTierSnapshot } = initReadTierSnapshot(buildDeps({
			tier0SourceExists: true,
			crawlStatus: "ready",
			canonicalSourceTier: "tier-1",
		}));

		const snapshot = await readTierSnapshot({ url: "https://example.com/e" });

		expect(snapshot).toEqual({
			tier0Status: "success",
			tier1Status: "success",
			pickedTier: "tier-1",
		});
	});
});
