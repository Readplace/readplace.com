const RESOLUTION_ON_VIEW_COOL_DOWN_MS = 24 * 60 * 60 * 1000;

export function resolutionOnViewCoolDownCutoff(now: Date): string {
	return new Date(now.getTime() - RESOLUTION_ON_VIEW_COOL_DOWN_MS).toISOString();
}
