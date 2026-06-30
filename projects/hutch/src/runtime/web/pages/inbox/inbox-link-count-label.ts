/** "12 links" / "1 link" / "200+ links" (truncated). `undefined` when there are
 * no links, so the caller omits the badge entirely. Shared by the inbox list row
 * and the email detail header so both phrase the count the same way. */
export function buildLinkCountLabel(input: { count: number; truncated: boolean }): string | undefined {
	if (input.count === 0) return undefined;
	// "N+" already implies more than N, so the truncated form is always plural.
	if (input.truncated) return `${input.count}+ links`;
	return `${input.count} ${input.count === 1 ? "link" : "links"}`;
}
