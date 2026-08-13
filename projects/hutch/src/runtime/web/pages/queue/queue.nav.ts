export const QUEUE_NAMES = ["default"] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export const DEFAULT_QUEUE_NAME: QueueName = "default";

interface QueueDefinition {
	title: string;
}

export interface Queue extends QueueDefinition {
	name: QueueName;
}

const QUEUE_DEFINITIONS: Record<QueueName, QueueDefinition> = {
	default: { title: "My Queue" },
};

export const QUEUES: readonly Queue[] = QUEUE_NAMES.map((name) => ({
	name,
	...QUEUE_DEFINITIONS[name],
}));

export function queueTitle(name: QueueName): string {
	return QUEUE_DEFINITIONS[name].title;
}
