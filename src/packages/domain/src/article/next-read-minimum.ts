export const NEXT_READ_MINIMUM_SAVES = 50;

export function hasEnoughSavesForNextRead(saveCount: number): boolean {
	return saveCount >= NEXT_READ_MINIMUM_SAVES;
}
