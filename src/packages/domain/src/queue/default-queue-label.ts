const DEFAULT_QUEUE_LABEL_PREFIX = "New Queue";

export function defaultQueueLabel(takenLabels: readonly string[]): string {
	const taken = new Set(takenLabels);
	let position = 1;
	while (taken.has(`${DEFAULT_QUEUE_LABEL_PREFIX} ${position}`)) position++;
	return `${DEFAULT_QUEUE_LABEL_PREFIX} ${position}`;
}
