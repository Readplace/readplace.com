import type { SaveAttemptId } from "@packages/domain/article";

export type PutPendingPdf = (params: {
	url: string;
	saveAttemptId: SaveAttemptId;
	bytes: Buffer;
}) => Promise<void>;

export type ReadPendingPdf = (url: string, options: { saveAttemptId: SaveAttemptId }) => Promise<Buffer>;
