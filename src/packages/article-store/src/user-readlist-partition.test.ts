import { ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import {
	READLIST_DEFINITION_KEY_PREFIX,
	decodeUserArticlePartition,
	readlistDefinitionKey,
	readlistPartitionValue,
} from "./user-readlist-partition";

const USER = "abc123" as UserId;
const WORK = ReadlistSlugSchema.parse("work");

describe("readlistPartitionValue", () => {
	it("round-trips through decodeUserArticlePartition", () => {
		const partition = readlistPartitionValue({ userId: USER, readlist: WORK });

		expect(decodeUserArticlePartition(partition)).toEqual({ userId: USER, readlist: WORK });
	});

	it("differs from the user's own partition so a copy never lands in the default listing", () => {
		expect(readlistPartitionValue({ userId: USER, readlist: WORK })).not.toBe(USER);
	});
});

describe("decodeUserArticlePartition", () => {
	it("reads a bare user id as a default-readlist row", () => {
		expect(decodeUserArticlePartition(USER)).toEqual({ userId: USER });
	});

	it("keeps the save-cursor sentinel's owner readable as a plain user id", () => {
		expect(decodeUserArticlePartition(`readplace:save-cursor/${USER}`)).toEqual({
			userId: `readplace:save-cursor/${USER}`,
		});
	});
});

describe("readlistDefinitionKey", () => {
	it("namespaces the definition row under a prefix a normalized article key can never take", () => {
		expect(readlistDefinitionKey(WORK)).toBe(`${READLIST_DEFINITION_KEY_PREFIX}work`);
	});
});
