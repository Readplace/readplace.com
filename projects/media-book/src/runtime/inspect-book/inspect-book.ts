import { strFromU8 } from "fflate";
import { MediaInspectedEvent, MediaRejectedEvent, type MediaUploadStagedDetail } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import { chapterTitle, tocTitlesFrom } from "../epub/epub-chapters";
import { isDrmEncryption } from "../epub/epub-encryption";
import { packagePathFrom, parsePackageDocument } from "../epub/epub-package";
import { type ByteRange, readRangedZipDirectory } from "../epub/ranged-zip-directory";
import { readRangedZipEntry } from "../epub/ranged-zip-entry";
import { BOOK_FAILURES, type BookFailure } from "../process-book/book-failure-notices";
import type { ReadStagedRange } from "../s3/s3-staged-range";

type BookInspectionRejectReason = Exclude<BookFailure, "too-large-for-reader">;
type BookInspection = { title: string; authors: string[]; sectionTitles: string[] } | BookInspectionRejectReason;

const EPUB_MIMETYPE = "application/epub+zip";

export type InspectBook = (detail: MediaUploadStagedDetail) => Promise<void>;

export function initInspectBook(deps: { readStagedRange: ReadStagedRange; publishEvent: PublishEvent; logger: Logger }): InspectBook {
	const inspect = async (params: { detail: MediaUploadStagedDetail; rangeBytes: number[] }): Promise<BookInspection> => {
		const { detail, rangeBytes } = params;
		const readRange = async (range: ByteRange) => {
			const bytes = await deps.readStagedRange({ uploadId: detail.uploadId, etag: detail.etag, range });
			if (bytes !== "staged-bytes-gone") rangeBytes.push(bytes.byteLength);
			return bytes;
		};
		const directory = await readRangedZipDirectory(readRange);
		if (directory === "not-a-zip") return "not-an-epub";
		if (directory === "staged-bytes-gone") return directory;
		const entries = new Map(directory.map((entry) => [entry.name, entry]));
		let gone = false;
		const readText = async (name: string | undefined): Promise<string | undefined> => {
			const entry = name === undefined ? undefined : entries.get(name);
			if (entry === undefined || gone) return undefined;
			const bytes = await readRangedZipEntry({ readRange, entry });
			if (bytes === "staged-bytes-gone") {
				gone = true;
				return undefined;
			}
			return strFromU8(bytes);
		};
		const settle = (inspection: BookInspection): BookInspection => (gone ? "staged-bytes-gone" : inspection);

		if (directory[0]?.name !== "mimetype" || (await readText("mimetype")) !== EPUB_MIMETYPE) return settle("not-an-epub");
		const encryptionXml = await readText("META-INF/encryption.xml");
		if (encryptionXml !== undefined && isDrmEncryption(encryptionXml)) return "drm-protected";
		const containerXml = await readText("META-INF/container.xml");
		const opfPath = containerXml === undefined ? "" : packagePathFrom(containerXml);
		const opfXml = await readText(opfPath);
		const pkg = opfXml === undefined ? "not-an-epub" : parsePackageDocument({ opfPath, opfXml, untitled: detail.fileName });
		if (pkg === "not-an-epub") return settle(pkg);
		const titles = tocTitlesFrom({ pkg, navXml: await readText(pkg.navPath), ncxXml: await readText(pkg.ncxPath) });
		const sectionTitles = pkg.spine.flatMap((path, index) => (entries.has(path) ? [chapterTitle({ titles, path, index })] : []));
		return settle({ title: pkg.title, authors: pkg.authors, sectionTitles });
	};

	return async (detail) => {
		const rangeBytes: number[] = [];
		const inspection = await inspect({ detail, rangeBytes });
		if (typeof inspection === "string") {
			const { reason, notice } = BOOK_FAILURES[inspection];
			await deps.publishEvent(MediaRejectedEvent, { uploadId: detail.uploadId, kind: detail.kind, reason, notice });
			deps.logger.info("[inspect-book] book rejected", { uploadId: detail.uploadId, rejection: inspection, reason, rangeBytes });
			return;
		}
		await deps.publishEvent(MediaInspectedEvent, { uploadId: detail.uploadId, kind: detail.kind, facts: { kind: "book", ...inspection } });
		deps.logger.info("[inspect-book] book inspected", { uploadId: detail.uploadId, sectionCount: inspection.sectionTitles.length, rangeBytes });
	};
}
