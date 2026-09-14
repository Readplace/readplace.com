import { noopLogger } from "@packages/hutch-logger";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryComputeRelatedPastReads } from "./in-memory-compute-related-past-reads";

const USER_ID = UserIdSchema.parse("user_abc");

describe("initInMemoryComputeRelatedPastReads", () => {
	it("records each published command, keeping the reading-list context when present", async () => {
		const { publishComputeRelatedPastReads, publishedComputeRelatedPastReads } =
			initInMemoryComputeRelatedPastReads({ logger: noopLogger });

		await publishComputeRelatedPastReads({
			url: "https://example.com/a",
			userId: USER_ID,
			readlist: "work",
		});
		await publishComputeRelatedPastReads({
			url: "https://example.com/b",
			userId: USER_ID,
		});

		expect(publishedComputeRelatedPastReads).toEqual([
			{ url: "https://example.com/a", userId: USER_ID, readlist: "work" },
			{ url: "https://example.com/b", userId: USER_ID },
		]);
	});
});
