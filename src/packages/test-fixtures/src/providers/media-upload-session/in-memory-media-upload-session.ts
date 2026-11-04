import type {
	CreateMediaUploadSession,
	FailMediaUpload,
	FindMediaUploadSession,
	MarkMediaUploadCommitted,
	MediaUploadSession,
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
