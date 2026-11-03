import assert from "node:assert/strict";
import { ReadlistFitOverrideIdSchema, ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import {
	READLIST_DEFINITION_KEY_PREFIX,
	READLIST_FIT_OVERRIDE_KEY_PREFIX,
	decodeUserArticlePartition,
	readlistDefinitionKey,
	readlistFitOverrideKey,
	readlistFitOverridePrefix,
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

describe("readlistFitOverrideKey", () => {
	it("nests a readlist's choices under its own prefix so one readlist's rows never match another's", () => {
		const id = ReadlistFitOverrideIdSchema.parse("0000000000000001-msg-0001");
		const key = readlistFitOverrideKey({ readlist: WORK, id });

		assert.equal(key, `${READLIST_FIT_OVERRIDE_KEY_PREFIX}work/0000000000000001-msg-0001`);
		assert.ok(key.startsWith(readlistFitOverridePrefix(WORK)));
		assert.ok(!key.startsWith(readlistFitOverridePrefix(ReadlistSlugSchema.parse("wor"))));
	});
});
