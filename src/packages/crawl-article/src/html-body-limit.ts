/**
 * Byte cap for bodies parsed through linkedom + Readability. Measured peak RSS
 * is ~80× the source size (the DOM alone is ~16×; Readability dominates), so
 * 28 MB peaks near 2.5 GB — the most that fits the account's 3008 MB
 * per-function Lambda ceiling. Larger bodies are refused as content-too-large
 * before parsing.
 */
export const MAX_HTML_BYTES = {
	bytes: 28 * 1024 * 1024,
	label: "28 MB",
} as const;
