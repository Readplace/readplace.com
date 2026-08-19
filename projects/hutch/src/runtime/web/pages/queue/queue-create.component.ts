import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QUEUE_LABEL_MAX_LENGTH, QUEUE_MAX_PER_USER } from "@packages/domain/queue";
import { render } from "@packages/web-shell";

const TEMPLATE = readFileSync(join(__dirname, "queue-create.template.html"), "utf-8");

export const QUEUE_CREATE_ERROR_NAME = "name";
export const QUEUE_CREATE_ERROR_NAME_TAKEN = "name-taken";
export const QUEUE_CREATE_ERROR_LIMIT = "limit";

const ERROR_MESSAGES = new Map<string, string>([
	[
		QUEUE_CREATE_ERROR_NAME,
		`Give the queue a name of ${QUEUE_LABEL_MAX_LENGTH} characters or fewer.`,
	],
	[QUEUE_CREATE_ERROR_NAME_TAKEN, "You already have a queue with that name."],
	[QUEUE_CREATE_ERROR_LIMIT, `You can keep up to ${QUEUE_MAX_PER_USER} queues.`],
]);

export function queueCreateErrorMessage(code: string | undefined): string | undefined {
	return code === undefined ? undefined : ERROR_MESSAGES.get(code);
}

export interface QueueCreateDisplayModel {
	action: string;
	cancelUrl: string;
	submittedLabel: string;
	maxLength: number;
	error?: string;
}

export function buildQueueCreate(input: {
	action: string;
	cancelUrl: string;
	submittedLabel: string;
	errorCode?: string;
}): QueueCreateDisplayModel {
	return {
		action: input.action,
		cancelUrl: input.cancelUrl,
		submittedLabel: input.submittedLabel,
		maxLength: QUEUE_LABEL_MAX_LENGTH,
		error: queueCreateErrorMessage(input.errorCode),
	};
}

export function renderQueueCreate(displayModel: QueueCreateDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
