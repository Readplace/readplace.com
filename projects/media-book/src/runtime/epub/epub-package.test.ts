import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { buildTestEpub } from "./build-test-epub";
import { readEpubChapters } from "./epub-chapters";
import { isDrmProtected } from "./epub-encryption";
import { parseEpubPackage } from "./epub-package";

const CHAPTERS = [
	{ file: "one.xhtml", title: "The Start", body: "<p>a</p>" },
	{ file: "two.xhtml", title: "The End", body: "<p>b</p>" },
];

function zip(files: Record<string, string>): Uint8Array {
	return zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])));
}

function encryption(algorithm: string): string {
	return `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${algorithm}"/><enc:CipherData><enc:CipherReference URI="OEBPS/one.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>`;
}

describe("parseEpubPackage", () => {
	it("reads the title, authors and spine from the package document", () => {
		const pkg = parseEpubPackage(buildTestEpub({ title: "A Book", authors: ["Ada", "Grace"], chapters: CHAPTERS }));

		assert.notEqual(pkg, "not-an-epub");
		assert.deepEqual(pkg, { title: "A Book", authors: ["Ada", "Grace"], spine: ["OEBPS/one.xhtml", "OEBPS/two.xhtml"], navPath: "OEBPS/nav.xhtml", ncxPath: undefined, manifestMediaTypes: new Map([["OEBPS/one.xhtml", "application/xhtml+xml"], ["OEBPS/two.xhtml", "application/xhtml+xml"], ["OEBPS/nav.xhtml", "application/xhtml+xml"]]) });
	});

	it("names a book without a title", () => {
		const pkg = parseEpubPackage(buildTestEpub({ chapters: CHAPTERS, toc: "ncx" }));

		assert.notEqual(pkg, "not-an-epub");
		assert.equal(pkg !== "not-an-epub" && pkg.title, "Untitled book");
	});

	it.each([
		["no container", zip({ mimetype: "x" })],
		["a container without a rootfile", zip({ "META-INF/container.xml": "<container/>" })],
		["a rootfile that is missing", zip({ "META-INF/container.xml": `<container><rootfiles><rootfile full-path="a.opf"/></rootfiles></container>` })],
		["an empty spine", zip({ "META-INF/container.xml": `<container><rootfiles><rootfile full-path="a.opf"/></rootfiles></container>`, "a.opf": `<package><manifest/><spine><itemref idref="x"/></spine></package>` })],
	])("refuses a file with %s", (_, bytes) => {
		assert.equal(parseEpubPackage(bytes), "not-an-epub");
	});
});

describe("readEpubChapters", () => {
	it.each(["nav", "ncx"] as const)("titles each chapter from the %s table of contents", (toc) => {
		const bytes = buildTestEpub({ title: "A Book", chapters: CHAPTERS, toc });
		const pkg = parseEpubPackage(bytes);
		assert.notEqual(pkg, "not-an-epub");

		const chapters = pkg === "not-an-epub" ? [] : readEpubChapters({ bytes, pkg });

		assert.deepEqual(chapters.map((chapter) => [chapter.path, chapter.title]), [["OEBPS/one.xhtml", "The Start"], ["OEBPS/two.xhtml", "The End"]]);
	});

	it("numbers a chapter the table of contents leaves out and skips a missing spine file", () => {
		const bytes = buildTestEpub({ title: "A Book", chapters: [...CHAPTERS, { file: "three.xhtml", title: "", body: "<p>c</p>" }] });
		const chapters = readEpubChapters({
			bytes,
			pkg: { title: "A Book", authors: [], spine: ["OEBPS/one.xhtml", "OEBPS/three.xhtml", "OEBPS/gone.xhtml"], navPath: "OEBPS/gone-nav.xhtml", ncxPath: "OEBPS/gone.ncx", manifestMediaTypes: new Map() },
		});

		assert.deepEqual(chapters.map((chapter) => chapter.title), ["Chapter 1", "Chapter 2"]);
	});
});

describe("isDrmProtected", () => {
	it("detects an encryption entry that covers content", () => {
		assert.equal(isDrmProtected(buildTestEpub({ chapters: CHAPTERS, extraFiles: { "META-INF/encryption.xml": encryption("http://www.w3.org/2001/04/xmlenc#aes128-cbc") } })), true);
	});

	it("accepts a book whose only encryption entries obfuscate fonts", () => {
		assert.equal(isDrmProtected(buildTestEpub({ chapters: CHAPTERS, extraFiles: { "META-INF/encryption.xml": encryption("http://www.idpf.org/2008/embedding") } })), false);
	});

	it("accepts a book without an encryption entry", () => {
		assert.equal(isDrmProtected(buildTestEpub({ chapters: CHAPTERS })), false);
	});
});
