export const READER_MAX_AGE_SECONDS = 1800;

export function readerCachePolicy(input: {
	requestedVersion: unknown;
	currentVersion: string;
	settled: boolean;
}): string {
	if (typeof input.requestedVersion !== "string") return "private, no-cache";
	if (input.requestedVersion !== input.currentVersion) return "private, no-cache";
	if (!input.settled) return "private, no-cache";
	return `private, max-age=${READER_MAX_AGE_SECONDS}`;
}
