export function truncateAtWordBoundary(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const slice = text.slice(0, maxChars - 1);
	const lastSpace = slice.lastIndexOf(" ");
	const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
	return `${cut.trimEnd()}…`;
}
