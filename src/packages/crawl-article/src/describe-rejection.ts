export function describeRejection(error: unknown): { name: string; reason: string } {
	return error instanceof Error
		? { name: error.name, reason: error.message }
		: { name: "unknown", reason: String(error) };
}
