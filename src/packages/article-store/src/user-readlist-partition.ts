import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema, type ReadlistSlug } from "@packages/domain/readlist";
import { UserIdSchema, type UserId } from "@packages/domain/user";

const READLIST_PARTITION_INFIX = "#queue/";

export const READLIST_DEFINITION_KEY_PREFIX = "readplace:queue-def/";

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
