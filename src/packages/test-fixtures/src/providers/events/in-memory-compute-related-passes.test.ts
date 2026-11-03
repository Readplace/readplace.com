import { UserIdSchema } from "@packages/domain/user";
import { noopLogger } from "@packages/hutch-logger";
import { initInMemoryComputeRelatedPasses } from "./in-memory-compute-related-passes";

describe("initInMemoryComputeRelatedPasses", () => {
	it("records each published command", async () => {
		const userId = UserIdSchema.parse("00000000000000000000000000000001");
		const { publishComputeRelatedPasses, publishedComputeRelatedPasses } = initInMemoryComputeRelatedPasses({
			logger: noopLogger,
		});

		await publishComputeRelatedPasses({ url: "https://example.com/post", userId });

		expect(publishedComputeRelatedPasses).toEqual([{ url: "https://example.com/post", userId }]);
	});
});
