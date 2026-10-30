export type ReadlistPurposeFields = { keep: string; skip?: string };

const KEEP_PREFIX = "Keep articles about: ";
const SKIP_PREFIX = "Skip: ";

function joinLines(lines: string[]): string {
	return lines.join("\n").trim();
}

export function parseReadlistPurposeFields(text: string): ReadlistPurposeFields {
	const lines = text.split(/\r?\n/);
	const [first, ...rest] = lines;
	if (!first.startsWith(KEEP_PREFIX)) return { keep: joinLines(lines) };
	const skipAt = rest.findIndex((line) => line.startsWith(SKIP_PREFIX));
	if (skipAt === -1) return { keep: joinLines([first.slice(KEEP_PREFIX.length), ...rest]) };
	return {
		keep: joinLines([first.slice(KEEP_PREFIX.length), ...rest.slice(0, skipAt)]),
		skip: joinLines([rest[skipAt].slice(SKIP_PREFIX.length), ...rest.slice(skipAt + 1)]),
	};
}

export function composeReadlistPurposeText(fields: ReadlistPurposeFields): string {
	const keepLine = `${KEEP_PREFIX}${fields.keep}`;
	return fields.skip === undefined ? keepLine : `${keepLine}\n${SKIP_PREFIX}${fields.skip}`;
}
