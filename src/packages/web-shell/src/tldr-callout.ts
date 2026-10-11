const SUMMARY_CALLOUT_OPENER = "> [!summary] Summary (TL;DR)";

export function tldrCallout(markdown: string): string {
	const quotedLines = markdown.split("\n").map((line) => (line === "" ? ">" : `> ${line}`));
	return [SUMMARY_CALLOUT_OPENER, ...quotedLines].join("\n");
}
