import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ReaderArticleHashId } from "@packages/domain/article";
import { PrivateItemUrlSchema, UploadIdSchema } from "@packages/media-contracts";
import { buildTestEpub } from "../epub/build-test-epub";
import { parseEpubPackage } from "../epub/epub-package";
import type { PutBookImage } from "../s3/put-book-image";
import { initStoreBookImage, readBookEntryFrom, type ReadBookEntry } from "./store-book-image";

const uploadId = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");
const itemUrl = PrivateItemUrlSchema.parse(`https://uploads.readplace.invalid/${uploadId}`);
const PNG = new Uint8Array([137, 80, 78, 71]);
const PNG_SHA = createHash("sha256").update(PNG).digest("hex");

function setUp(entries: Record<string, { bytes: Uint8Array; mediaType: string }>) {
	const puts: Parameters<PutBookImage>[0][] = [];
	const readEntry: ReadBookEntry = async (zipPath) => entries[zipPath];
	const resolveImage = initStoreBookImage({
		putBookImage: async (input) => {
			puts.push(input);
		},
	})({ uploadId, itemUrl, readEntry });
	return { resolveImage, puts };
}

describe("initStoreBookImage", () => {
	it("puts the image under the upload's prefix and answers its reader route", async () => {
		const { resolveImage, puts } = setUp({ "OEBPS/images/a.png": { bytes: PNG, mediaType: "image/png" } });

		const src = await resolveImage("OEBPS/images/a.png");

		assert.equal(src, `/queue/${ReaderArticleHashId.from(itemUrl).value}/media/${PNG_SHA}.png`);
		assert.deepEqual(puts, [{ uploadId, file: `${PNG_SHA}.png`, bytes: PNG, contentType: "image/png" }]);
	});

	it("gives the same bytes under two paths one key", async () => {
		const { resolveImage, puts } = setUp({ "OEBPS/a.png": { bytes: PNG, mediaType: "image/png" }, "OEBPS/b.png": { bytes: PNG, mediaType: "image/png" } });

		assert.equal(await resolveImage("OEBPS/a.png"), await resolveImage("OEBPS/b.png"));
		assert.deepEqual(new Set(puts.map((put) => put.file)), new Set([`${PNG_SHA}.png`]));
	});

	it.each([
		["a type outside the image map", { "OEBPS/a.tif": { bytes: PNG, mediaType: "image/tiff" } }, "OEBPS/a.tif"],
		["an entry the book does not hold", {}, "OEBPS/gone.png"],
	])("answers nothing and puts nothing for %s", async (_, entries, zipPath) => {
		const { resolveImage, puts } = setUp(entries);

		assert.equal(await resolveImage(zipPath), undefined);
		assert.deepEqual(puts, []);
	});
});

describe("readBookEntryFrom", () => {
	const bytes = buildTestEpub({
		chapters: [{ file: "one.xhtml", title: "One", body: "<p>a</p>" }],
		images: [{ file: "images/a.png", mediaType: "image/png", bytes: PNG }],
		extraFiles: { "OEBPS/images/unlisted.png": "x" },
	});
	const pkg = parseEpubPackage(bytes);
	assert(pkg !== "not-an-epub");
	const readEntry = readBookEntryFrom({ bytes, pkg: { ...pkg, manifestMediaTypes: new Map([...pkg.manifestMediaTypes, ["OEBPS/images/gone.png", "image/png"]]) } });

	it("reads an entry's bytes and its manifest media type", async () => {
		assert.deepEqual(await readEntry("OEBPS/images/a.png"), { bytes: PNG, mediaType: "image/png" });
	});

	it.each([
		["the manifest does not list", "OEBPS/images/unlisted.png"],
		["the zip does not hold", "OEBPS/images/gone.png"],
	])("answers nothing for an entry %s", async (_, zipPath) => {
		assert.equal(await readEntry(zipPath), undefined);
	});
});
