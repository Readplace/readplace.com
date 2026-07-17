export function toResolvedUrl(input: {
	url: string;
	finalUrl: string | undefined;
}): string | undefined {
	if (input.finalUrl === undefined) return undefined;
	const extracted = new URL(input.url);
	const terminal = new URL(input.finalUrl);
	extracted.hash = "";
	terminal.hash = "";
	if (extracted.href === terminal.href) return undefined;
	return input.finalUrl;
}
