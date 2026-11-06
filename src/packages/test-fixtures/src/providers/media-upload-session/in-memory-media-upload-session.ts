import assert from "node:assert";
import type {
	AnyMediaUploadSession,
	ClaimMediaUpload,
	ClaimedMediaUpload,
	CreateAnyMediaUploadSession,
	CreateMediaUploadSession,
	FailMediaUpload,
	FindMediaUploadByCapability,
	FindMediaUploadSession,
	HeadMediaPendingOriginal,
	MarkMediaUploadCommitted,
	MarkMediaUploadInspecting,
	MediaUploadSession,
	MintMediaPendingPost,
	PresignEnclosure,
	PresignMediaImage,
	PublishMediaUploadCommitted,
	PublishMediaUploadStaged,
	ReadMediaPendingPrefix,
	RecordMediaInspection,
} from "@packages/domain";

export interface InMemoryMediaUploadSessions {
	createMediaUploadSession: CreateMediaUploadSession;
	findMediaUploadSession: FindMediaUploadSession;
	markMediaUploadCommitted: MarkMediaUploadCommitted;
	failMediaUpload: FailMediaUpload;
	createAnyMediaUploadSession: CreateAnyMediaUploadSession;
	markMediaUploadInspecting: MarkMediaUploadInspecting;
	recordMediaInspection: RecordMediaInspection;
	claimMediaUpload: ClaimMediaUpload;
	findMediaUploadByCapability: FindMediaUploadByCapability;
}

type StoredMediaUploadSession = AnyMediaUploadSession & { readonly etag?: string };

export function initInMemoryMediaUploadSessions(): InMemoryMediaUploadSessions {
	const sessions = new Map<string, StoredMediaUploadSession>();
	const signedIn = (uploadId: string) => {
		const session = sessions.get(uploadId);
		return session?.userId === undefined ? undefined : session;
	};
	const anonymous = (uploadId: string) => {
		const session = sessions.get(uploadId);
		return session?.userId === undefined ? session : undefined;
	};

	return {
		createMediaUploadSession: async (params) => {
			const session: MediaUploadSession = { ...params, status: "staged" };
			sessions.set(session.uploadId, session);
			return session;
		},
		findMediaUploadSession: async ({ uploadId, userId }) => {
			const session = signedIn(uploadId);
			return session?.userId === userId ? session : undefined;
		},
		markMediaUploadCommitted: async ({ uploadId, userId }) => {
			const session = signedIn(uploadId);
			if (session?.userId !== userId || session.status !== "staged") return "not-staged";
			sessions.set(uploadId, { ...session, status: "committed" });
			return "committed";
		},
		failMediaUpload: async ({ uploadId }) => {
			const session = signedIn(uploadId);
			if (session?.status !== "committed") return "not-committed";
			sessions.set(uploadId, { ...session, status: "failed" });
			return "failed";
		},
		createAnyMediaUploadSession: async ({ userId, ...params }) => {
			assert(!sessions.has(params.uploadId), `upload ${params.uploadId} already exists`);
			const session: AnyMediaUploadSession =
				userId === undefined ? { ...params, status: "staged" } : { ...params, userId, status: "staged" };
			sessions.set(session.uploadId, session);
			return session;
		},
		markMediaUploadInspecting: async ({ uploadId, etag }) => {
			const session = anonymous(uploadId);
			if (session?.status !== "staged") return "not-staged";
			sessions.set(uploadId, { ...session, status: "inspecting", etag });
			return "inspecting";
		},
		recordMediaInspection: async ({ uploadId, inspection }) => {
			const session = anonymous(uploadId);
			if (session?.status !== "inspecting") return "not-inspecting";
			if (inspection.verdict === "inspected") {
				sessions.set(uploadId, { ...session, status: "ready", facts: inspection.facts });
				return "ready";
			}
			sessions.set(uploadId, { ...session, status: "rejected", reason: inspection.reason, notice: inspection.notice });
			return "rejected";
		},
		claimMediaUpload: async ({ uploadId, userId }) => {
			const session = sessions.get(uploadId);
			if (session?.etag === undefined) return "not-claimable";
			const unclaimedReady = session.userId === undefined && session.status === "ready";
			const sameReaderAgain = session.userId === userId && session.status === "staged";
			if (!unclaimedReady && !sameReaderAgain) return "not-claimable";
			const claimed: ClaimedMediaUpload = {
				uploadId: session.uploadId,
				userId,
				kind: session.kind,
				fileName: session.fileName,
				byteLength: session.byteLength,
				saveAttemptId: session.saveAttemptId,
				status: "staged",
				etag: session.etag,
			};
			sessions.set(uploadId, { ...session, ...claimed });
			return claimed;
		},
		findMediaUploadByCapability: async ({ uploadId, userId }) => {
			const session = sessions.get(uploadId);
			if (session === undefined) return undefined;
			return session.userId === undefined || session.userId === userId ? session : undefined;
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

export function initInMemoryPresignMediaImage(): {
	presignMediaImage: PresignMediaImage;
	presignedMediaImages: Parameters<PresignMediaImage>[0][];
} {
	const presignedMediaImages: Parameters<PresignMediaImage>[0][] = [];
	return {
		presignMediaImage: async (input) => {
			presignedMediaImages.push(input);
			return `https://media.test/images/${input.uploadId}/${input.file}`;
		},
		presignedMediaImages,
	};
}

export function initInMemoryPresignEnclosure(): {
	presignEnclosure: PresignEnclosure;
	presignedEnclosures: Parameters<PresignEnclosure>[0][];
} {
	const presignedEnclosures: Parameters<PresignEnclosure>[0][] = [];
	return {
		presignEnclosure: async (input) => {
			presignedEnclosures.push(input);
			return `https://media.test/${input.object}`;
		},
		presignedEnclosures,
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

export function initInMemoryMediaUploadStaged(): {
	publishMediaUploadStaged: PublishMediaUploadStaged;
	publishedMediaUploadStaged: Parameters<PublishMediaUploadStaged>[0][];
} {
	const publishedMediaUploadStaged: Parameters<PublishMediaUploadStaged>[0][] = [];
	return {
		publishMediaUploadStaged: async (detail) => {
			publishedMediaUploadStaged.push(detail);
		},
		publishedMediaUploadStaged,
	};
}
