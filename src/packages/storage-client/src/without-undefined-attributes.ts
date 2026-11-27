export function withoutUndefinedAttributes(item: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined));
}
