export function normalizeUnknownError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}
