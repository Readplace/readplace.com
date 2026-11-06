import assert from "node:assert/strict";
import { buildBookBody } from "./book-body";
import { largestReaderPageBytes } from "./book-pages";
import { chapterXhtml } from "./build-test-epub";

const noImages = async () => undefined;

function bookOf(chapters: { title: string; body: string }[]) {
	return buildBookBody({
		chapters: chapters.map((chapter, index) => ({ path: `OEBPS/c${index}.xhtml`, title: chapter.title, xhtml: chapterXhtml(chapter.body) })),
		resolveImage: noImages,
	});
}

describe("largestReaderPageBytes", () => {
	it("measures a later chapter as a page of its own, in bytes", async () => {
		const body = await bookOf([
			{ title: "One", body: "<p>a</p>" },
			{ title: "Two", body: `<p>${"é".repeat(400)}</p>` },
			{ title: "Three", body: "<p>c</p>" },
		]);

		assert.equal(largestReaderPageBytes(body), Buffer.byteLength(`<h2 id="section-ch-2">Two</h2><p>${"é".repeat(400)}</p>`));
	});

	it("measures the first page as the in-body contents plus the first chapter", async () => {
		const body = await bookOf([
			{ title: "One", body: "<p>same</p>" },
			{ title: "Two", body: "<p>same</p>" },
		]);

		assert.equal(largestReaderPageBytes(body), body.html.indexOf(`<h2 id="section-ch-2">`));
	});

	it("keeps a chapter's own h2 on that chapter's page", async () => {
		const body = await bookOf([
			{ title: "One", body: "<p>a</p>" },
			{ title: "Two", body: `<h2>Inner</h2><p>${"b".repeat(400)}</p>` },
		]);

		assert.equal(largestReaderPageBytes(body), Buffer.byteLength(`<h2 id="section-ch-2">Two</h2><h2>Inner</h2><p>${"b".repeat(400)}</p>`));
	});

	it("measures a single-chapter book as the whole body", async () => {
		const body = await bookOf([{ title: "One", body: "<p>only</p>" }]);

		assert.equal(largestReaderPageBytes(body), Buffer.byteLength(body.html));
	});
});
