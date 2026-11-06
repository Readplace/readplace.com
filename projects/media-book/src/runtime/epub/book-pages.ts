import assert from "node:assert";
import { chapterSectionId } from "@packages/domain/article";
import type { BookBody } from "./book-body";

export function largestReaderPageBytes(body: Pick<BookBody, "html" | "sectionCount">): number {
	const pageStarts = Array.from({ length: body.sectionCount - 1 }, (_, index) => chapterSectionId(index + 2)).reduce(
		(starts, id) => {
			const start = body.html.indexOf(`<h2 id="${id}">`, starts[starts.length - 1]);
			assert(start !== -1, `book body has no heading ${id}`);
			starts.push(start);
			return starts;
		},
		[0],
	);
	return Math.max(...pageStarts.map((start, index) => Buffer.byteLength(body.html.slice(start, pageStarts[index + 1]))));
}
