import type { SaveAttemptId } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";

export type MediaWriteContext = {
	url: string;
	attemptId: SaveAttemptId;
	authorUserId?: UserId;
};

export type PutImageObject = (params: {
	key: string;
	body: Buffer;
	contentType: string;
	writeContext?: MediaWriteContext;
}) => Promise<void>;
