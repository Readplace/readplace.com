import { createHash } from "node:crypto";
import { ReaderArticleHashId } from "@packages/domain/article";
import { mediaImageFileOf, type PrivateItemUrl, type UploadId } from "@packages/media-contracts";
import type { ResolveImage } from "../epub/book-body";
import type { EpubPackage } from "../epub/epub-package";
import { readZipEntryBytes } from "../epub/zip-entries";
import type { PutBookImage } from "../s3/put-book-image";

type BookEntry = { bytes: Uint8Array; mediaType: string };
export type ReadBookEntry = (zipPath: string) => Promise<BookEntry | undefined>;
export type StoreBookImagesFor = (upload: { uploadId: UploadId; itemUrl: PrivateItemUrl; readEntry: ReadBookEntry }) => ResolveImage;

export function readBookEntryFrom(book: { bytes: Uint8Array; pkg: EpubPackage }): ReadBookEntry {
	return (zipPath) => {
		const mediaType = book.pkg.manifestMediaTypes.get(zipPath);
		if (mediaType === undefined) return Promise.resolve(undefined);
		const bytes = readZipEntryBytes({ bytes: book.bytes, name: zipPath });
		return Promise.resolve(bytes === undefined ? undefined : { bytes, mediaType });
	};
}

export function initStoreBookImage(deps: { putBookImage: PutBookImage }): StoreBookImagesFor {
	return ({ uploadId, itemUrl, readEntry }) => {
		const routeId = ReaderArticleHashId.from(itemUrl).value;
		const store = (entry: BookEntry) => {
			const file = mediaImageFileOf({ sha256Hex: createHash("sha256").update(entry.bytes).digest("hex"), mediaType: entry.mediaType });
			return file === undefined
				? undefined
				: deps.putBookImage({ uploadId, file, bytes: entry.bytes, contentType: entry.mediaType }).then(() => `/queue/${routeId}/media/${file}`);
		};
		return (zipPath) => readEntry(zipPath).then((entry) => (entry === undefined ? undefined : store(entry)));
	};
}
