import { QueueSlugSchema } from "@packages/domain/queue";
import type { UserId } from "@packages/domain/user";
import {
	QUEUE_DEFINITION_KEY_PREFIX,
	decodeUserArticlePartition,
	queueDefinitionKey,
	queuePartitionValue,
} from "./user-queue-partition";

const USER = "abc123" as UserId;
const WORK = QueueSlugSchema.parse("work");

describe("queuePartitionValue", () => {
	it("round-trips through decodeUserArticlePartition", () => {
		const partition = queuePartitionValue({ userId: USER, queue: WORK });

		expect(decodeUserArticlePartition(partition)).toEqual({ userId: USER, queue: WORK });
	});

	it("differs from the user's own partition so a copy never lands in the default listing", () => {
		expect(queuePartitionValue({ userId: USER, queue: WORK })).not.toBe(USER);
	});
});

describe("decodeUserArticlePartition", () => {
	it("reads a bare user id as a default-queue row", () => {
		expect(decodeUserArticlePartition(USER)).toEqual({ userId: USER });
	});

	it("keeps the save-cursor sentinel's owner readable as a plain user id", () => {
		expect(decodeUserArticlePartition(`readplace:save-cursor/${USER}`)).toEqual({
			userId: `readplace:save-cursor/${USER}`,
		});
	});
});

describe("queueDefinitionKey", () => {
	it("namespaces the definition row under a prefix a normalized article key can never take", () => {
		expect(queueDefinitionKey(WORK)).toBe(`${QUEUE_DEFINITION_KEY_PREFIX}work`);
	});
});
