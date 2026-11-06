import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { MediaUploadStagedEvent } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { Logger, noopLogger } from "@packages/logger";
import { buildTestEpub } from "../epub/build-test-epub";
import { readRangesOf } from "../epub/ranged-zip-test-reader";
import type { ReadStagedRange } from "../s3/s3-staged-range";
import { initInspectBook } from "./inspect-book";

const DETAIL = MediaUploadStagedEvent.detailSchema.parse({
	uploadId: "0123456789abcdef0123456789abcdef",
	kind: "book",
	mediaType: "application/epub+zip",
	fileName: "my-book.epub",
	size: 1000,
	etag: '"etag"',
	stagedAt: "2026-11-06T10:00:00Z",
});
const CHAPTERS = [
	{ file: "one.xhtml", title: "The Start", body: "<p>a</p>" },
	{ file: "two.xhtml", title: "The End", body: "<p>b</p>" },
];
const CONTAINER = `<container><rootfiles><rootfile full-path="a.opf"/></rootfiles></container>`;
const READABLE_BOOK = {
	"META-INF/container.xml": CONTAINER,
	"a.opf": `<package><manifest><item id="a" href="one.xhtml"/></manifest><spine><itemref idref="a"/></spine></package>`,
	"one.xhtml": "<html/>",
};

function encryption(algorithm: string): string {
	return `<encryption xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/></enc:EncryptedData></encryption>`;
}

function zip(files: Record<string, string>): Uint8Array {
	return zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])));
}

function setUp(bytes: Uint8Array, options: { goneFromRead?: number } = {}) {
	const published: { event: string; detail: unknown }[] = [];
	const reads: Parameters<ReadStagedRange>[0][] = [];
	const { readRange } = readRangesOf(bytes);
	const publishEvent: PublishEvent = async (event, detail) => {
		published.push({ event: event.detailType, detail });
	};
	const inspectBook = initInspectBook({
		readStagedRange: async (params) => {
			reads.push(params);
			return options.goneFromRead !== undefined && reads.length > options.goneFromRead ? "staged-bytes-gone" : readRange(params.range);
		},
		publishEvent,
		logger: Logger.from(noopLogger),
	});
	return { inspect: () => inspectBook(DETAIL), published, reads };
}

function rejected(reason: string, notice: string) {
	return [{ event: "MediaRejected", detail: { uploadId: DETAIL.uploadId, kind: "book", reason, notice } }];
}

const NOT_AN_EPUB = rejected("unreadable", "This file isn't an EPUB we can read. Check the file and upload it again.");
const GONE = rejected("staged-bytes-gone", "We couldn't find the file you uploaded. Please upload it again.");

describe("initInspectBook", () => {
	it.each(["nav", "ncx"] as const)("publishes the title, authors and %s section titles of a readable EPUB from ranged reads of the staged original", async (toc) => {
		const { inspect, published, reads } = setUp(buildTestEpub({ title: "A Book", authors: ["Ada", "Grace"], chapters: CHAPTERS, toc }));

		await inspect();

		assert.deepEqual(published, [
			{ event: "MediaInspected", detail: { uploadId: DETAIL.uploadId, kind: "book", facts: { kind: "book", title: "A Book", authors: ["Ada", "Grace"], sectionTitles: ["The Start", "The End"] } } },
		]);
		assert.ok(reads.every((read) => read.uploadId === DETAIL.uploadId && read.etag === DETAIL.etag));
		assert.deepEqual(reads[0]?.range, { suffixLength: 65_557 });
	});

	it("titles an untitled book by its file name, numbers a section the table of contents leaves out and skips a spine file that is not in the zip", async () => {
		const opf = `<package><manifest><item id="a" href="OEBPS/one.xhtml"/><item id="b" href="OEBPS/gone.xhtml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>`;
		const { inspect, published } = setUp(zip({ mimetype: "application/epub+zip", "META-INF/container.xml": CONTAINER, "a.opf": opf, "OEBPS/one.xhtml": "<html/>" }));

		await inspect();

		assert.deepEqual(published, [
			{ event: "MediaInspected", detail: { uploadId: DETAIL.uploadId, kind: "book", facts: { kind: "book", title: "my-book.epub", authors: [], sectionTitles: ["Chapter 2"] } } },
		]);
	});

	it("rejects an EPUB whose encryption goes beyond font obfuscation as DRM-protected", async () => {
		const { inspect, published } = setUp(buildTestEpub({ chapters: CHAPTERS, extraFiles: { "META-INF/encryption.xml": encryption("http://www.w3.org/2001/04/xmlenc#aes128-cbc") } }));

		await inspect();

		assert.deepEqual(published, rejected("unreadable", "This book is protected by DRM, so we can't open it. Upload a DRM-free copy."));
	});

	it("inspects an EPUB whose only encryption obfuscates fonts", async () => {
		const { inspect, published } = setUp(buildTestEpub({ title: "Fonts", chapters: CHAPTERS, extraFiles: { "META-INF/encryption.xml": encryption("http://www.idpf.org/2008/embedding") } }));

		await inspect();

		assert.deepEqual(published.map((event) => event.event), ["MediaInspected"]);
	});

	it.each([
		["a file that is not a zip", strToU8("plain text, no zip here")],
		["an empty zip", zipSync({})],
		["a zip whose first entry is not the mimetype", zip({ ...READABLE_BOOK, mimetype: "application/epub+zip" })],
		["a mimetype other than EPUB's", zip({ mimetype: "application/zip", ...READABLE_BOOK })],
		["no container", zip({ mimetype: "application/epub+zip" })],
		["a package document that is missing", zip({ mimetype: "application/epub+zip", "META-INF/container.xml": CONTAINER })],
		["an empty spine", zip({ mimetype: "application/epub+zip", "META-INF/container.xml": CONTAINER, "a.opf": "<package><manifest/><spine/></package>" })],
	])("rejects %s as unreadable", async (_, bytes) => {
		const { inspect, published } = setUp(bytes);

		await inspect();

		assert.deepEqual(published, NOT_AN_EPUB);
	});

	it.each([
		["the tail", 0],
		["the mimetype entry", 2],
		["the encryption entry", 3],
		["the table of contents", 6],
	])("rejects the upload as gone when %s can no longer be read", async (_, goneFromRead) => {
		const book = buildTestEpub({ title: "A Book", chapters: CHAPTERS, extraFiles: { "META-INF/encryption.xml": encryption("http://www.idpf.org/2008/embedding") } });
		const { inspect, published } = setUp(book, { goneFromRead });

		await inspect();

		assert.deepEqual(published, GONE);
	});
});
