export function bytesToMb(bytes: number): number {
	return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}
