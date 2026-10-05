export function errorClassName(error: unknown): string {
	return error instanceof Error ? error.name : `non-error:${typeof error}`;
}
