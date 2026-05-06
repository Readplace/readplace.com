export function flattenZodErrors(
	issues: { path: PropertyKey[]; message: string }[],
): { field: string; message: string }[] {
	return issues.map((issue) => ({
		field: String(issue.path[issue.path.length - 1]),
		message: issue.message,
	}));
}
