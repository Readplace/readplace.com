import assert from "node:assert";
import { createHash } from "node:crypto";
import {
	DEFAULT_READLIST_SLUG,
	type ReadlistFitOverrideId,
	ReadlistSlugSchema,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import { UserIdSchema, type UserId } from "@packages/domain/user";

const READLIST_PARTITION_INFIX = "#queue/";

export const READLIST_DEFINITION_KEY_PREFIX = "readplace:queue-def/";

export const BULK_ARTICLE_JOB_PREFIX = "readplace:bulk-articles/";

export const READLIST_DEFINITIONS_REVISION_ATTRIBUTE = "definitionRevision";

export function readlistDefinitionsRevisionKey(userId: string) {
	return { userId, url: "readplace:queue-revision" };
}

export function readlistDefinitionsRevisionIncrement(userId: string) {
	return {
		Key: readlistDefinitionsRevisionKey(userId),
		UpdateExpression: "SET #revision = if_not_exists(#revision, :zero) + :one",
		ExpressionAttributeNames: { "#revision": READLIST_DEFINITIONS_REVISION_ATTRIBUTE },
		ExpressionAttributeValues: { ":zero": 0, ":one": 1 },
	};
}

export const CANONICAL_REMOVAL_PREFIX = "readplace:removed-article/";

export function canonicalRemovalKey(userId: string, url: string) {
	return { userId, url: CANONICAL_REMOVAL_PREFIX + createHash("sha256").update(url).digest("hex") };
}

export const HIGHLIGHT_KEY_PREFIX = "readplace:highlight/";

export const READLIST_FIT_OVERRIDE_KEY_PREFIX = "readplace:queue-override/";

const REMOVED_LINKS_PARTITION_SUFFIX = "#removed";

export function removedLinksPartition(userId: UserId): string {
	return `${userId}${REMOVED_LINKS_PARTITION_SUFFIX}`;
}

export function removedLinkKey(params: { jobId: string; storedKey: string }): string {
	return `readplace:removed/${params.jobId}/${createHash("sha256").update(params.storedKey).digest("hex")}`;
}

export function savedLinksJobKey(userId: UserId): string {
	return `readplace:saved-links-job/${userId}`;
}

export function readlistPartitionValue(params: { userId: UserId; readlist: ReadlistSlug }): string {
	return `${params.userId}${READLIST_PARTITION_INFIX}${params.readlist}`;
}

export function partitionFor(params: { userId: UserId; readlist: ReadlistSlug }): string {
	return params.readlist === DEFAULT_READLIST_SLUG ? params.userId : readlistPartitionValue(params);
}

export function readlistPartitionPrefix(userId: UserId): string {
	return `${userId}${READLIST_PARTITION_INFIX}`;
}

export function decodeUserArticlePartition(value: string): {
	userId: UserId;
	readlist?: ReadlistSlug;
} {
	assert(!value.endsWith(REMOVED_LINKS_PARTITION_SUFFIX), "a removed-links holding partition is not a readlist partition");
	const infixAt = value.indexOf(READLIST_PARTITION_INFIX);
	if (infixAt === -1) return { userId: UserIdSchema.parse(value) };
	return {
		userId: UserIdSchema.parse(value.slice(0, infixAt)),
		readlist: ReadlistSlugSchema.parse(value.slice(infixAt + READLIST_PARTITION_INFIX.length)),
	};
}

export function readlistDefinitionKey(readlist: ReadlistSlug): string {
	return `${READLIST_DEFINITION_KEY_PREFIX}${readlist}`;
}

export function readlistFitOverridePrefix(readlist: ReadlistSlug): string {
	return `${READLIST_FIT_OVERRIDE_KEY_PREFIX}${readlist}/`;
}

export function readlistFitOverrideKey(params: { readlist: ReadlistSlug; id: ReadlistFitOverrideId }): string {
	return `${readlistFitOverridePrefix(params.readlist)}${params.id}`;
}
