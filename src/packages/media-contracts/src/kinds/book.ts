import { defineMediaKind } from "../media-kind";

const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const EPUB_FIRST_ENTRY = Buffer.from("mimetypeapplication/epub+zip", "ascii");
const FIRST_ENTRY_OFFSET = 30;

export const BOOK = defineMediaKind({
	name: "book",
	label: "Book",
	accepts: { "application/epub+zip": [".epub"] },
	uploadCeilingBytes: 200 * 1024 * 1024,
	ceilingLabel: "200 MB",
	sniff: (firstBytes) => {
		const bytes = Buffer.from(firstBytes);
		return (
			bytes.subarray(0, ZIP_LOCAL_HEADER.length).equals(ZIP_LOCAL_HEADER) &&
			bytes.subarray(FIRST_ENTRY_OFFSET, FIRST_ENTRY_OFFSET + EPUB_FIRST_ENTRY.length).equals(EPUB_FIRST_ENTRY)
		);
	},
});
