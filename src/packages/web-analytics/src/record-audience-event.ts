import type { Request } from "express";
import type { HutchLogger } from "@packages/hutch-logger";
import { isBotRequest } from "./analytics";

export type RecordAudienceEvent<T> = (req: Request, event: T) => void;

export type RecordUngatedEvent<T> = (event: T) => void;

export function initRecordAudienceEvent<T>(deps: {
	logger: HutchLogger.Typed<T>;
}): RecordAudienceEvent<T> {
	return (req, event) => {
		if (isBotRequest(req)) return;
		deps.logger.info(event);
	};
}
