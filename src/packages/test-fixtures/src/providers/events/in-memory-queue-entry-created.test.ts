import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger } from "@packages/hutch-logger";
import { initInMemoryQueueEntryCreated } from "./in-memory-queue-entry-created";

describe("initInMemoryQueueEntryCreated", () => {
	it("records the event it would have published", async () => {
		const logged: unknown[][] = [];
		const logger = HutchLogger.from({
			info: (...args: unknown[]) => {
				logged.push(args);
			},
			error: () => {},
			warn: () => {},
			debug: () => {},
		});
		const { publishQueueEntryCreated, publishedQueueEntryCreated } =
			initInMemoryQueueEntryCreated({ logger });

		await publishQueueEntryCreated({
			url: "https://example.com/post",
			userId: UserIdSchema.parse("user_abc"),
		});

		assert.equal(logged.length, 1);
		assert.deepEqual(logged[0]?.[1], {
			url: "https://example.com/post",
			userId: "user_abc",
		});
		assert.deepEqual(publishedQueueEntryCreated, [
			{ url: "https://example.com/post", userId: "user_abc" },
		]);
	});
});
