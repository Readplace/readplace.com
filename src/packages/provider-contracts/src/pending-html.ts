import type { SaveAttemptId } from "@packages/domain/article";

export type PutPendingHtml = (params: {
	url: string;
	saveAttemptId: SaveAttemptId;
	html: string;
}) => Promise<void>;
