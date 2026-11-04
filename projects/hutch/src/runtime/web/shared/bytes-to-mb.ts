function bytesToMb(bytes: number): number {
	return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

export function megabytesLabel(bytes: number): string {
	return `${bytesToMb(bytes)} MB`;
}
