import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger } from "@packages/hutch-logger";
import { initInMemoryComputeRelatedArticles } from "./in-memory-compute-related-articles";

describe("initInMemoryComputeRelatedArticles", () => {
	it("records the command it would have published", async () => {
		const logged: unknown[][] = [];
		const logger = HutchLogger.from({
			info: (...args: unknown[]) => {
				logged.push(args);
			},
			error: () => {},
			warn: () => {},
			debug: () => {},
		});
		const { publishComputeRelatedArticles, publishedComputeRelatedArticles } =
			initInMemoryComputeRelatedArticles({ logger });

		await publishComputeRelatedArticles({
			url: "https://example.com/post",
			userId: UserIdSchema.parse("user_abc"),
		});

		assert.equal(logged.length, 1);
		assert.deepEqual(logged[0]?.[1], {
			url: "https://example.com/post",
			userId: "user_abc",
		});
		assert.deepEqual(publishedComputeRelatedArticles, [
			{ url: "https://example.com/post", userId: "user_abc" },
		]);
	});
});
