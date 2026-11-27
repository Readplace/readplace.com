import type { SaveAttemptId } from "@packages/domain/article";

export type PutPendingPdf = (params: {
	url: string;
	saveAttemptId: SaveAttemptId;
	bytes: Buffer;
}) => Promise<void>;
