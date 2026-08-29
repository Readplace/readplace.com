import { nextAvailableReadlistLabel } from "./next-available-readlist-label";

const DEFAULT_READLIST_LABEL = "New Readlist";

export function defaultReadlistLabel(takenLabels: readonly string[]): string {
	return nextAvailableReadlistLabel({ label: DEFAULT_READLIST_LABEL, takenLabels });
}
