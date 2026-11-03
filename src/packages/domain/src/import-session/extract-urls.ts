import { collectImportLinks } from "./collect-import-links";
import type { ImportLinksResult } from "./import-session.types";

const URL_REGEX = /\bhttps?:\/\/(?:[^\s<>"'()[\]{}|\\^`]|\([^\s<>"'()[\]{}|\\^`]*\))+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?>'"\]]+$/;
const CSV_URL_HEADER = /^(?:[^,\r\n]*,)*url(?:,|\r?\n|$)/i;
const FIRST_COMMA_ONWARD = /,.*$/;

function decodeBuffer(buffer: Buffer): string {
	const utf8 = buffer.toString("utf8");
	if (utf8.includes("�")) {
		return buffer.toString("latin1");
	}
	return utf8;
}

export function extractUrls(buffer: Buffer): ImportLinksResult {
	const text = decodeBuffer(buffer);
	const matches = text.match(URL_REGEX);
	if (!matches) return { urls: [], truncated: false, totalFound: 0 };

	const candidates = CSV_URL_HEADER.test(text)
		? matches.map((raw) => raw.replace(FIRST_COMMA_ONWARD, ""))
		: matches;
	const stripped = candidates.map((raw) =>
		raw.replace(TRAILING_PUNCTUATION, ""),
	);
	return collectImportLinks(stripped);
}
