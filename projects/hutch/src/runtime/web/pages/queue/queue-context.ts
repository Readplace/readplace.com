import { DEFAULT_QUEUE_SLUG } from "@packages/domain/queue";
import type { UserId } from "@packages/domain/user";
import type { ListQueueDefinitions } from "@packages/provider-contracts/article-store";
import type { FeatureToggleSource, QuerystringFeatureToggle } from "@packages/web-shell";
import { DEFAULT_QUEUE, type Queue } from "./queue.nav";
import { type LinkParams, type QueueUrlState, parseQueueUrl } from "./queue.url";

export const QUEUES_FEATURE = "queues";

const QUEUES_LINK_PARAMS: LinkParams = [["feature", QUEUES_FEATURE]];

export interface QueueContext {
	state: QueueUrlState;
	activeQueue: Queue;
	queues: readonly Queue[];
	linkParams: LinkParams;
	railed: boolean;
}

const MAINLINE_QUEUES: readonly Queue[] = [DEFAULT_QUEUE];

export function mainlineQueueContext(query: Record<string, unknown>): QueueContext {
	return {
		state: { ...parseQueueUrl(query), queue: DEFAULT_QUEUE_SLUG },
		activeQueue: DEFAULT_QUEUE,
		queues: MAINLINE_QUEUES,
		linkParams: [],
		railed: false,
	};
}

export function initResolveQueueContext(deps: {
	listQueueDefinitions: ListQueueDefinitions;
	featureToggle: QuerystringFeatureToggle;
}): (
	req: FeatureToggleSource & { query: Record<string, unknown> },
	userId: UserId,
) => Promise<QueueContext> {
	return async (req, userId) => {
		if (!deps.featureToggle.isEnabled(req, QUEUES_FEATURE)) {
			return mainlineQueueContext(req.query);
		}
		const definitions = await deps.listQueueDefinitions(userId);
		const queues: readonly Queue[] = [
			DEFAULT_QUEUE,
			...definitions.map((definition) => ({ slug: definition.slug, label: definition.label })),
		];
		const requested = parseQueueUrl(req.query);
		const activeQueue = queues.find((queue) => queue.slug === requested.queue) ?? DEFAULT_QUEUE;
		return {
			state: { ...requested, queue: activeQueue.slug },
			activeQueue,
			queues,
			linkParams: QUEUES_LINK_PARAMS,
			railed: true,
		};
	};
}
