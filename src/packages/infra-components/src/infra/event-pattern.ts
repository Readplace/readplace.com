type DetailMatcher = string | { readonly prefix: string };

export type DetailFilter = Readonly<Record<string, ReadonlyArray<DetailMatcher>>>;

export function eventPatternFor(rule: {
	source: string;
	detailType: string;
	detail?: DetailFilter;
}): string {
	return JSON.stringify({
		source: [rule.source],
		"detail-type": [rule.detailType],
		detail: rule.detail,
	});
}
