import assert from "node:assert/strict";
import { BOOK } from "./book";

function storedZipEntry(entry: { name: string; body: string }): Buffer {
	const header = Buffer.alloc(30);
	header.writeUInt32LE(0x04034b50, 0);
	header.writeUInt16LE(20, 4);
	header.writeUInt32LE(Buffer.byteLength(entry.body), 18);
	header.writeUInt32LE(Buffer.byteLength(entry.body), 22);
	header.writeUInt16LE(Buffer.byteLength(entry.name), 26);
	return Buffer.concat([header, Buffer.from(entry.name), Buffer.from(entry.body)]);
}

const CONTAINER_ENTRY = { name: "META-INF/container.xml", body: "<container/>" };

describe("BOOK", () => {
	it("sniffs the first bytes of an EPUB, whose first entry is its stored mimetype", () => {
		const prefix = Buffer.concat([
			storedZipEntry({ name: "mimetype", body: "application/epub+zip" }),
			storedZipEntry(CONTAINER_ENTRY),
		]);

		assert.equal(BOOK.sniff(prefix), true);
	});

	it("does not sniff a plain ZIP as a book", () => {
		assert.equal(BOOK.sniff(storedZipEntry(CONTAINER_ENTRY)), false);
	});

	it("does not sniff a ZIP whose mimetype entry names another media type", () => {
		const prefix = storedZipEntry({ name: "mimetype", body: "application/vnd.oasis.opendocument.text" });

		assert.equal(BOOK.sniff(prefix), false);
	});

	it("does not sniff the EPUB entry without a ZIP local header", () => {
		const prefix = Buffer.concat([Buffer.alloc(30), Buffer.from("mimetypeapplication/epub+zip")]);

		assert.equal(BOOK.sniff(prefix), false);
	});

	it("does not sniff a PDF as a book", () => {
		assert.equal(BOOK.sniff(Buffer.from("%PDF-1.7\n")), false);
	});

	it("does not sniff an empty object as a book", () => {
		assert.equal(BOOK.sniff(new Uint8Array()), false);
	});

	it("accepts only EPUB files", () => {
		assert.deepEqual(BOOK.accepts, { "application/epub+zip": [".epub"] });
	});

	it("states its 200 MiB ceiling as 200 MB", () => {
		assert.equal(BOOK.uploadCeilingBytes, 200 * 1024 * 1024);
		assert.equal(BOOK.ceilingLabel, "200 MB");
	});
});
