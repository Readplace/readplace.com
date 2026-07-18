/* c8 ignore start -- thin AWS SDK wrapper, tested via integration + mint-upload-url.test.ts */
import assert from "node:assert";
import { GetObjectCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type {
	CreateUploadSlot,
	ReadPendingUploadPrefix,
	StatPendingUpload,
} from "@packages/provider-contracts/pending-upload";
import { mintUploadUrl } from "./mint-upload-url";

function locate(deps: { pdfBucketName: string; htmlBucketName: string }, url: string, mediaType: string) {
	const id = ArticleResourceUniqueId.parse(url);
	if (mediaType === "application/pdf") {
		return { bucket: deps.pdfBucketName, key: id.toS3PendingPdfKey() };
	}
	assert(mediaType === "text/html", `unsupported upload media type: ${mediaType}`);
	return { bucket: deps.htmlBucketName, key: id.toS3PendingHtmlKey() };
}

export function initS3PendingUpload(deps: {
	presignerClient: S3Client;
	client: S3Client;
	pdfBucketName: string;
	htmlBucketName: string;
	ttlSeconds: number;
	now: () => Date;
}): {
	createUploadSlot: CreateUploadSlot;
	statPendingUpload: StatPendingUpload;
	readPendingUploadPrefix: ReadPendingUploadPrefix;
} {
	const createUploadSlot: CreateUploadSlot = async ({ url, mediaType, byteLength }) => {
		const { bucket, key } = locate(deps, url, mediaType);
		const uploadUrl = await mintUploadUrl({
			client: deps.presignerClient,
			bucket,
			key,
			contentType: mediaType,
			contentLength: byteLength,
			expiresIn: deps.ttlSeconds,
		});
		return { uploadUrl, expiresAt: new Date(deps.now().getTime() + deps.ttlSeconds * 1000) };
	};

	const statPendingUpload: StatPendingUpload = async ({ url, mediaType }) => {
		const { bucket, key } = locate(deps, url, mediaType);
		try {
			const head = await deps.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
			assert(head.ContentLength !== undefined && head.LastModified, "HeadObject missing size/mtime");
			return { byteLength: head.ContentLength, lastModified: head.LastModified };
		} catch (error) {
			if (error instanceof Error && error.name === "NotFound") return undefined;
			throw error;
		}
	};

	const readPendingUploadPrefix: ReadPendingUploadPrefix = async ({ url, mediaType, bytes }) => {
		const { bucket, key } = locate(deps, url, mediaType);
		const result = await deps.client.send(
			new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
		);
		assert(result.Body, "GetObject returned no body");
		return Buffer.from(await result.Body.transformToByteArray());
	};

	return { createUploadSlot, statPendingUpload, readPendingUploadPrefix };
}
/* c8 ignore stop */
