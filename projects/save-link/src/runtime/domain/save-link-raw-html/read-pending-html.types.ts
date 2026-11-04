import type { SaveAttemptId } from "@packages/domain/article";

export type ReadPendingHtml = (url: string, options: { saveAttemptId: SaveAttemptId }) => Promise<{ html: string; capturedAt: string }>;
