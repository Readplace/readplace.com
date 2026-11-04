import type { Request } from "express";
import type { Logger } from "@packages/logger";
import { isBotRequest } from "./analytics";

export type RecordAudienceEvent<T> = (req: Request, event: T) => void;

export type RecordUngatedEvent<T> = (event: T) => void;

export function initRecordAudienceEvent<T>(deps: {
	logger: Logger.Typed<T>;
}): RecordAudienceEvent<T> {
	return (req, event) => {
		if (isBotRequest(req)) return;
		deps.logger.info(event);
	};
}
