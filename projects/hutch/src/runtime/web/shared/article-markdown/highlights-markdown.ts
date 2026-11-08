import { htmlToMarkdown } from "@packages/web-shell";
import type { ReaderHighlightState } from "../article-body/reader-slot/mark-highlights";
import { highlightsXhtml } from "../epub/highlights-xhtml";

export function highlightsMarkdown(states: readonly ReaderHighlightState[]): string {
	if (states.length === 0) return "";
	return `\n${htmlToMarkdown(highlightsXhtml(states))}\n`;
}
