import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type {
	CreateUploadSlot,
	ReadPendingUploadPrefix,
	StatPendingUpload,
} from "@packages/provider-contracts/pending-upload";

export interface InMemoryPendingUpload {
	createUploadSlot: CreateUploadSlot;
	statPendingUpload: StatPendingUpload;
	readPendingUploadPrefix: ReadPendingUploadPrefix;
	stageUploaded: (params: { url: string; mediaType: string; bytes: Buffer; stagedAt?: Date; saveAttemptId: string }) => void;
	receiveUpload: (key: string, bytes: Buffer) => void;
}

function keyFor(params: { url: string; mediaType: string; saveAttemptId: string }): string {
	const { url, mediaType, saveAttemptId } = params;
	const id = ArticleResourceUniqueId.parse(url);
	return mediaType === "application/pdf" ? id.toS3PendingPdfKey(saveAttemptId) : id.toS3PendingHtmlKey(saveAttemptId);
}

export function initInMemoryPendingUpload(deps: {
	uploadBaseUrl: string;
	now: () => Date;
	ttlSeconds: number;
}): InMemoryPendingUpload {
	const store = new Map<string, { bytes: Buffer; mtime: Date }>();

	const createUploadSlot: CreateUploadSlot = async ({ url, mediaType, saveAttemptId }) => ({
		uploadUrl: `${deps.uploadBaseUrl}/${encodeURIComponent(keyFor({ url, mediaType, saveAttemptId }))}`,
		expiresAt: new Date(deps.now().getTime() + deps.ttlSeconds * 1000),
	});

	const statPendingUpload: StatPendingUpload = async ({ url, mediaType, saveAttemptId }) => {
		const entry = store.get(keyFor({ url, mediaType, saveAttemptId }));
		return entry ? { byteLength: entry.bytes.length, lastModified: entry.mtime } : undefined;
	};

	const readPendingUploadPrefix: ReadPendingUploadPrefix = async ({ url, mediaType, bytes, saveAttemptId }) => {
		const entry = store.get(keyFor({ url, mediaType, saveAttemptId }));
		assert(entry, `no staged upload for ${url}`);
		return entry.bytes.subarray(0, bytes);
	};

	return {
		createUploadSlot,
		statPendingUpload,
		readPendingUploadPrefix,
		stageUploaded: ({ url, mediaType, bytes, stagedAt, saveAttemptId }) => {
			store.set(keyFor({ url, mediaType, saveAttemptId }), { bytes, mtime: stagedAt ?? deps.now() });
		},
		receiveUpload: (key, bytes) => {
			store.set(key, { bytes, mtime: deps.now() });
		},
	};
}
