import { CandidateIdSchema, SaveAttemptIdSchema } from "@packages/domain/article";
import { RecrawlContentExtractedEvent, TierContentExtractedEvent } from "@packages/hutch-infra-components";
import { initPublishArchiveComparison } from "./publish-archive-comparison";

const wrapper = { id: CandidateIdSchema.parse("wrapper-candidate"), tier: "tier-2" as const };
const saveAttemptId = SaveAttemptIdSchema.parse("attempt-1");

function setup() {
	const published: Array<{ detailType: string; detail: unknown }> = [];
	const publishArchiveComparison = initPublishArchiveComparison({
		publishEvent: async (event, detail) => {
			published.push({ detailType: event.detailType, detail });
		},
		now: () => new Date("2026-11-04T00:00:00.000Z"),
	});
	return { published, publishArchiveComparison };
}

describe("initPublishArchiveComparison", () => {
	it("publishes a save's selection over the stored candidates as a no-body live attempt", async () => {
		const { published, publishArchiveComparison } = setup();

		const termination = await publishArchiveComparison({ url: "https://example.com/post", userId: "user-1", saveAttemptId, candidates: [wrapper] });

		expect(termination).toEqual({ via: "deferred-to-event" });
		expect(published).toEqual([{
			detailType: TierContentExtractedEvent.detailType,
			detail: {
				url: "https://example.com/post",
				userId: "user-1",
				saveAttemptId,
				candidates: [wrapper],
				liveAttempt: { outcome: "no-body" },
				extractedAt: "2026-11-04T00:00:00.000Z",
			},
		}]);
	});

	it("publishes the recrawl selection for a recrawl", async () => {
		const { published, publishArchiveComparison } = setup();

		await publishArchiveComparison({ url: "https://example.com/post", recrawl: true, saveAttemptId, candidates: [wrapper] });

		expect(published.map((entry) => entry.detailType)).toEqual([RecrawlContentExtractedEvent.detailType]);
	});

	it("carries the given failure reason on the live attempt", async () => {
		const { published, publishArchiveComparison } = setup();

		await publishArchiveComparison({ url: "https://example.com/post", saveAttemptId, candidates: [wrapper], failureReason: { kind: "exhausted-retries", receiveCount: 1 } });

		expect(published.map((entry) => entry.detail)).toEqual([expect.objectContaining({
			liveAttempt: { outcome: "no-body", failureReason: { kind: "exhausted-retries", receiveCount: 1 } },
		})]);
	});
});
