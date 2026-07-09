/** Escape every regex metacharacter in `value` so it can be embedded in a
 * `RegExp` and match literally — `escapeRegExp("a.b")` yields `a\.b`, which
 * matches the three-character string `a.b` rather than "a, any char, b". */
export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
