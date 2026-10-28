import type { LogThumbnailNotDelivered, ThumbnailNotDeliveredEvent } from "@packages/crawl-article";
import { formatErrorLogLine, HutchLogger } from "@packages/hutch-logger";
import {
	initLogParseError,
	initLogCrawlOutcome,
	type ParseErrorEvent,
	type CrawlOutcomeEvent,
	type LogParseError,
	type LogCrawlOutcome,
} from "@packages/hutch-infra-components";
import type { ImageLeftAtOriginEvent } from "../domain/save-link/download-media";

export type LogError = (message: string, error?: Error) => void;

export type LogInfo = (message: string) => void;

export type { LogThumbnailNotDelivered };

export type LogImageLeftAtOrigin = (event: ImageLeftAtOriginEvent) => void;

export type ParseErrorSource = ParseErrorEvent["source"];

export type ObservabilityDepBundle = {
	logger: HutchLogger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	logError: LogError;
	logInfo: LogInfo;
	logThumbnailNotDelivered: LogThumbnailNotDelivered;
	logImageLeftAtOrigin: LogImageLeftAtOrigin;
};

export function initObservabilityDepBundle(deps: {
	logger: HutchLogger;
	source: ParseErrorSource;
	now: () => Date;
}): ObservabilityDepBundle {
	const logError: LogError = (message, error) =>
		deps.logger.error(formatErrorLogLine({ message, error, now: deps.now }));
	const logInfo: LogInfo = (message) => deps.logger.info(message);
	const { logParseError } = initLogParseError({
		logger: HutchLogger.fromJSON<ParseErrorEvent>(),
		now: deps.now,
		source: deps.source,
	});
	const { logCrawlOutcome } = initLogCrawlOutcome({
		logger: HutchLogger.fromJSON<CrawlOutcomeEvent>(),
		now: deps.now,
	});
	return {
		logger: deps.logger,
		logParseError,
		logCrawlOutcome,
		logError,
		logInfo,
		logThumbnailNotDelivered: HutchLogger.fromJSON<ThumbnailNotDeliveredEvent>().warn,
		logImageLeftAtOrigin: HutchLogger.fromJSON<ImageLeftAtOriginEvent>().warn,
	};
}
