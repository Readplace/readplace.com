const TILE_CASE_TRIAL_OFFSET_MS = ((2 * 24 + 23) * 60 + 18) * 60 * 1000;

export function trialEndShowingTiles(): string {
	return new Date(Date.now() + TILE_CASE_TRIAL_OFFSET_MS).toISOString();
}
