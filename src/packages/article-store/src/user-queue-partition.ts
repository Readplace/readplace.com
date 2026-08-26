import { DEFAULT_QUEUE_SLUG, QueueSlugSchema, type QueueSlug } from "@packages/domain/queue";
import { UserIdSchema, type UserId } from "@packages/domain/user";

const QUEUE_PARTITION_INFIX = "#queue/";

export const QUEUE_DEFINITION_KEY_PREFIX = "readplace:queue-def/";

export function queuePartitionValue(params: { userId: UserId; queue: QueueSlug }): string {
	return `${params.userId}${QUEUE_PARTITION_INFIX}${params.queue}`;
}

export function partitionFor(params: { userId: UserId; queue: QueueSlug }): string {
	return params.queue === DEFAULT_QUEUE_SLUG ? params.userId : queuePartitionValue(params);
}

export function queuePartitionPrefix(userId: UserId): string {
	return `${userId}${QUEUE_PARTITION_INFIX}`;
}

export function decodeUserArticlePartition(value: string): {
	userId: UserId;
	queue?: QueueSlug;
} {
	const infixAt = value.indexOf(QUEUE_PARTITION_INFIX);
	if (infixAt === -1) return { userId: UserIdSchema.parse(value) };
	return {
		userId: UserIdSchema.parse(value.slice(0, infixAt)),
		queue: QueueSlugSchema.parse(value.slice(infixAt + QUEUE_PARTITION_INFIX.length)),
	};
}

export function queueDefinitionKey(queue: QueueSlug): string {
	return `${QUEUE_DEFINITION_KEY_PREFIX}${queue}`;
}
