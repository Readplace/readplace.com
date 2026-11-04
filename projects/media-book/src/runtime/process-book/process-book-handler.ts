import { createHash } from "node:crypto";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { initDynamoDbPrivateItem } from "@packages/article-store";
import { calculateReadTime } from "@packages/domain/article";
import { MediaProcessingFailedEvent, MediaUploadCommittedEvent, TierContentExtractedEvent, type MediaUploadCommittedDetail } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import { candidateProvenance, KIND_BY_TIER, type PutTierSource } from "@packages/tier-source";
import { z } from "zod";
import { buildBookBody } from "../epub/book-body";
import { largestReaderPageBytes } from "../epub/book-pages";
import { readEpubChapters } from "../epub/epub-chapters";
import { isDrmProtected } from "../epub/epub-encryption";
import { parseEpubPackage } from "../epub/epub-package";
import { listZipEntries } from "../epub/zip-entries";
import type { DownloadStagedObject } from "../s3/download-staged-object";
import { BOOK_FAILURES, type BookFailure } from "./book-failure-notices";
import { readBookEntryFrom, type StoreBookImagesFor } from "./store-book-image";

type RecordPrivateItemSections = ReturnType<typeof initDynamoDbPrivateItem>["recordPrivateItemSections"];

const TIER = "tier-0";

const CommittedEnvelope = z.object({ time: z.string(), detail: MediaUploadCommittedEvent.detailSchema });

function isZip(bytes: Uint8Array): boolean {
	try {
		listZipEntries(bytes);
		return true;
	} catch {
		return false;
	}
}

export function initProcessBookHandler(deps: {
	downloadStagedObject: DownloadStagedObject;
	recordPrivateItemSections: RecordPrivateItemSections;
	putTierSource: PutTierSource;
	storeBookImagesFor: StoreBookImagesFor;
	publishEvent: PublishEvent;
	readerBodyByteLimit: number;
	wholeBodyByteLimit: number;
	largestSectionByteLimit: number;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const fail = async (detail: MediaUploadCommittedDetail, failure: BookFailure) => {
		const { reason, notice } = BOOK_FAILURES[failure];
		await deps.publishEvent(MediaProcessingFailedEvent, {
			uploadId: detail.uploadId,
			kind: detail.kind,
			url: detail.url,
			saveAttemptId: detail.saveAttemptId,
			attempt: detail.attempt,
			reason,
			notice,
		});
		deps.logger.info("[process-book] book failed", { uploadId: detail.uploadId, failure, reason });
	};

	const processBook = async (envelope: z.infer<typeof CommittedEnvelope>) => {
		const { detail, time } = envelope;
		const staged = await deps.downloadStagedObject({ uploadId: detail.uploadId, etag: detail.etag });
		if (staged === "staged-bytes-gone") return fail(detail, "staged-bytes-gone");
		if (!isZip(staged.bytes)) return fail(detail, "not-an-epub");
		if (isDrmProtected(staged.bytes)) return fail(detail, "drm-protected");
		const pkg = parseEpubPackage(staged.bytes);
		if (pkg === "not-an-epub") return fail(detail, "not-an-epub");
		const storeImage = deps.storeBookImagesFor({ uploadId: detail.uploadId, itemUrl: detail.url, readEntry: readBookEntryFrom({ bytes: staged.bytes, pkg }) });
		let imagesWritten = 0;
		const resolveImage = (zipPath: string) =>
			storeImage(zipPath).then((src) => {
				if (src !== undefined) imagesWritten += 1;
				return src;
			});
		const body = await buildBookBody({ chapters: readEpubChapters({ bytes: staged.bytes, pkg }), resolveImage });
		const bodyBytes = Buffer.byteLength(body.html);
		if (bodyBytes > deps.wholeBodyByteLimit) return fail(detail, "too-large-for-reader");
		if (bodyBytes > deps.readerBodyByteLimit && largestReaderPageBytes(body) > deps.largestSectionByteLimit) return fail(detail, "too-large-for-reader");

		const recorded = await deps.recordPrivateItemSections({ url: detail.url, sectionCount: body.sectionCount });
		if (recorded === "not-found") {
			deps.logger.info("[process-book] item released while processing", { uploadId: detail.uploadId, imagesWritten });
			return;
		}

		const metadata = candidateProvenance({
			metadata: {
				title: pkg.title,
				siteName: pkg.authors[0] ?? "Book",
				excerpt: body.excerpt,
				wordCount: body.wordCount,
				estimatedReadTime: calculateReadTime(body.wordCount),
				authorUserId: detail.userId,
			},
			html: body.html,
			evaluationHtml: body.html,
			attemptId: detail.saveAttemptId,
			originalUrl: detail.url,
			sourceUrl: detail.url,
			kind: KIND_BY_TIER[TIER],
			fetchedAt: time,
		});
		await deps.putTierSource({ url: detail.url, tier: TIER, html: body.html, evaluationHtml: body.html, metadata });
		await deps.publishEvent(TierContentExtractedEvent, {
			url: detail.url,
			saveAttemptId: detail.saveAttemptId,
			candidates: [{ id: metadata.id, tier: TIER }],
			userId: detail.userId,
			extractedAt: time,
		});
		deps.logger.info("[process-book] book processed", {
			uploadId: detail.uploadId,
			sectionCount: body.sectionCount,
			bodyBytes,
			sha256: staged.sha256,
			contentHash: createHash("sha256").update(body.html).digest("hex"),
		});
	};

	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				await processBook(CommittedEnvelope.parse(JSON.parse(record.body)));
			} catch (error) {
				deps.logger.error("[process-book] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
