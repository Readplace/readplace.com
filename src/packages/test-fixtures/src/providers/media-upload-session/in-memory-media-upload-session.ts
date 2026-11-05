import assert from "node:assert";
import type {
	CreateMediaUploadSession,
	FailMediaUpload,
	FindMediaUploadSession,
	HeadMediaPendingOriginal,
	MarkMediaUploadCommitted,
	MediaUploadSession,
	MintMediaPendingPost,
	PublishMediaUploadCommitted,
	ReadMediaPendingPrefix,
} from "@packages/domain";

export interface InMemoryMediaUploadSessions {
	createMediaUploadSession: CreateMediaUploadSession;
	findMediaUploadSession: FindMediaUploadSession;
	markMediaUploadCommitted: MarkMediaUploadCommitted;
	failMediaUpload: FailMediaUpload;
}

export function initInMemoryMediaUploadSessions(): InMemoryMediaUploadSessions {
	const sessions = new Map<string, MediaUploadSession>();

	return {
		createMediaUploadSession: async (params) => {
			const session: MediaUploadSession = { ...params, status: "staged" };
			sessions.set(session.uploadId, session);
			return session;
		},
		findMediaUploadSession: async ({ uploadId, userId }) => {
			const session = sessions.get(uploadId);
			return session?.userId === userId ? session : undefined;
		},
		markMediaUploadCommitted: async ({ uploadId, userId }) => {
			const session = sessions.get(uploadId);
			if (session?.userId !== userId || session.status !== "staged") return "not-staged";
			sessions.set(uploadId, { ...session, status: "committed" });
			return "committed";
		},
		failMediaUpload: async ({ uploadId }) => {
			const session = sessions.get(uploadId);
			if (session?.status !== "committed") return "not-committed";
			sessions.set(uploadId, { ...session, status: "failed" });
			return "failed";
		},
	};
}

export interface InMemoryMediaPending {
	mintMediaPendingPost: MintMediaPendingPost;
	headMediaPendingOriginal: HeadMediaPendingOriginal;
	readMediaPendingPrefix: ReadMediaPendingPrefix;
	receivePendingOriginal: (params: { uploadId: MediaUploadSession["uploadId"]; bytes: Uint8Array }) => void;
}

export function initInMemoryMediaPending(deps: { uploadBaseUrl: string }): InMemoryMediaPending {
	const originals = new Map<string, { bytes: Uint8Array; etag: string }>();

	return {
		mintMediaPendingPost: async ({ uploadId, contentType, successActionRedirect }) => ({
			url: deps.uploadBaseUrl,
			fields: {
				key: `pending/${uploadId}/original`,
				"Content-Type": contentType,
				success_action_redirect: successActionRedirect,
			},
		}),
		headMediaPendingOriginal: async ({ uploadId }) => {
			const original = originals.get(uploadId);
			return original ? { etag: original.etag, size: original.bytes.length } : undefined;
		},
		readMediaPendingPrefix: async ({ uploadId, etag, bytes }) => {
			const original = originals.get(uploadId);
			assert(original?.etag === etag, `no pending original ${uploadId} with etag ${etag}`);
			return original.bytes.subarray(0, bytes);
		},
		receivePendingOriginal: ({ uploadId, bytes }) => {
			originals.set(uploadId, { bytes, etag: `"etag-${uploadId}"` });
		},
	};
}

export function initInMemoryMediaUploadCommitted(): {
	publishMediaUploadCommitted: PublishMediaUploadCommitted;
	publishedMediaUploadCommitted: Parameters<PublishMediaUploadCommitted>[0][];
} {
	const publishedMediaUploadCommitted: Parameters<PublishMediaUploadCommitted>[0][] = [];
	return {
		publishMediaUploadCommitted: async (params) => {
			publishedMediaUploadCommitted.push(params);
		},
		publishedMediaUploadCommitted,
	};
}
