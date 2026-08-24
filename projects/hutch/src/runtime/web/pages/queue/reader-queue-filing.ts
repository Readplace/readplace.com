import type { QueueSlug } from "@packages/domain/queue";
import type { QueueDefinitionData } from "@packages/provider-contracts/article-store";
import type { ReaderQueueTags } from "../../shared/article-body/article-header/article-header.component";
import type { ReaderQueuePicker } from "../../shared/article-body/reader-actions/reader-actions.component";
import { QUEUE_PATH } from "./queue.url";

export interface ReaderQueueFiling {
	tags: ReaderQueueTags | undefined;
	picker: ReaderQueuePicker | undefined;
}

export function buildReaderQueueFiling(input: {
	articleId: string;
	definitions: readonly QueueDefinitionData[];
	saves: readonly { queue?: QueueSlug }[];
	returnTo: string;
}): ReaderQueueFiling {
	const memberSlugs = new Set(
		input.saves.flatMap((save) => (save.queue === undefined ? [] : [save.queue])),
	);
	const holdsDefaultCopy = input.saves.some((save) => save.queue === undefined);
	const assigned = input.definitions.filter((definition) => memberSlugs.has(definition.slug));
	const assignable = holdsDefaultCopy
		? input.definitions.filter((definition) => !memberSlugs.has(definition.slug))
		: [];
	return {
		tags:
			assigned.length === 0
				? undefined
				: {
						unassignUrl: `${QUEUE_PATH}/${input.articleId}/unassign`,
						returnTo: input.returnTo,
						tags: assigned.map(({ slug, label }) => ({ slug, label })),
					},
		picker:
			assignable.length === 0
				? undefined
				: {
						assignUrl: `${QUEUE_PATH}/${input.articleId}/assign`,
						returnTo: input.returnTo,
						options: assignable.map(({ slug, label }) => ({ slug, label })),
					},
	};
}
