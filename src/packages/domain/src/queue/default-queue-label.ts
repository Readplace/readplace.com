import { nextAvailableQueueLabel } from "./next-available-queue-label";

const DEFAULT_QUEUE_LABEL = "New Queue";

export function defaultQueueLabel(takenLabels: readonly string[]): string {
	return nextAvailableQueueLabel({ label: DEFAULT_QUEUE_LABEL, takenLabels });
}
