import type { ComponentError } from "../shared/component-error.types";

export function flattenZodErrors(
	issues: { path: PropertyKey[]; message: string }[],
): ComponentError[] {
	return issues.map((issue) => ({
		fieldName: String(issue.path[issue.path.length - 1]),
		message: issue.message,
	}));
}
