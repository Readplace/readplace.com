import type { CodeSpanOnOneLine } from "./markdown-conversion";

export const codeSpanOnOneLine: CodeSpanOnOneLine = (content) =>
	content.includes("\n")
		? content
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line !== "")
				.join(" ")
		: content;
