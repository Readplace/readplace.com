const SECTION_SEPARATOR = "\n\n";

function splitAtSectionHeadings(html: string): string[] {
	return html.split(/(?=<h2\b)/i);
}

function shareBudget(params: { lengths: number[]; budget: number }): number[] {
	const shares = params.lengths.map(() => 0);
	const shortestFirst = params.lengths.map((length, index) => ({ length, index })).sort((a, b) => a.length - b.length);
	let remaining = params.budget;
	shortestFirst.forEach(({ length, index }, position) => {
		const share = Math.min(length, Math.floor(remaining / (shortestFirst.length - position)));
		shares[index] = share;
		remaining -= share;
	});
	return shares;
}

export function sampleSectionsForSummary(params: {
	html: string;
	maxChars: number;
	cleanContent: (html: string) => string;
}): string {
	const whole = params.cleanContent(params.html);
	if (whole.length <= params.maxChars) return whole;

	const sections = splitAtSectionHeadings(params.html)
		.map(params.cleanContent)
		.filter((text) => text.length > 0);
	const budget = params.maxChars - SECTION_SEPARATOR.length * (sections.length - 1);
	const shares = shareBudget({ lengths: sections.map((text) => text.length), budget });
	return sections.map((text, index) => text.slice(0, shares[index])).join(SECTION_SEPARATOR);
}
