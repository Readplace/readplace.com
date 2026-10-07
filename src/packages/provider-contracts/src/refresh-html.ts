import type { SaveAttemptId } from "@packages/domain/article";

export type PutRefreshHtml = (params: {
	url: string;
	html: string;
	evaluationHtml: string;
	saveAttemptId: SaveAttemptId;
}) => Promise<void>;

export type ReadRefreshHtml = (url: string, options: { saveAttemptId: SaveAttemptId; representation?: "evaluation" }) => Promise<string>;
