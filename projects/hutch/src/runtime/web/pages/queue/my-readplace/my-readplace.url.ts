import { z } from "zod";
import { QUEUE_COUNTS_PATH, QUEUE_PATH } from "../queue.url";

export const MY_READPLACE_FEATURE = "my";

export const MY_READPLACE_TAB_ID = "my";

export const MY_READPLACE_SAVE_PATH = `${QUEUE_PATH}/my-readplace`;

const MyReadplaceQuerySchema = z.object({
	edit: z.string().optional().catch(undefined),
	invalid: z.string().optional().catch(undefined),
}).passthrough();

export function parseMyReadplaceState(query: Record<string, unknown>): {
	edit: boolean;
	invalid: boolean;
} {
	const parsed = MyReadplaceQuerySchema.parse(query);
	return { edit: parsed.edit === "1", invalid: parsed.invalid === "1" };
}

export function buildMyReadplaceUrl(options?: { edit?: boolean; invalid?: boolean }): string {
	const params = new URLSearchParams();
	params.set("tab", MY_READPLACE_TAB_ID);
	params.set("feature", MY_READPLACE_FEATURE);
	if (options?.edit) params.set("edit", "1");
	if (options?.invalid) params.set("invalid", "1");
	return `${QUEUE_PATH}?${params.toString()}`;
}

export function buildMyReadplaceCountsUrl(): string {
	return `${QUEUE_COUNTS_PATH}?tab=${MY_READPLACE_TAB_ID}&feature=${MY_READPLACE_FEATURE}`;
}

export function buildMyReadplaceSaveUrl(): string {
	return `${MY_READPLACE_SAVE_PATH}?feature=${MY_READPLACE_FEATURE}`;
}
