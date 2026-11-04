import type { SaveAttemptId } from "@packages/domain/article";

export type ReadPendingPdf = (url: string, options: { saveAttemptId: SaveAttemptId }) => Promise<{ bytes: Buffer; capturedAt: string }>;
