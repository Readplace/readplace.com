import type { LogThumbnailNotDelivered, ThumbnailNotDeliveredEvent } from "@packages/crawl-article";
import { formatErrorLogLine, Logger } from "@packages/logger";
import {
	initLogParseError,
	initLogCrawlOutcome,
	initLogCrawlSettled,
	type ParseErrorEvent,
	type CrawlOutcomeEvent,
	type CrawlSettledEvent,
	type LogParseError,
	type LogCrawlOutcome,
	type LogCrawlSettled,
} from "@packages/infra-components";
import type { ImageLeftAtOriginEvent } from "../domain/save-link/download-media";

export type LogError = (message: string, error?: Error) => void;

export type LogInfo = (message: string) => void;

export type { LogThumbnailNotDelivered };

export type LogImageLeftAtOrigin = (event: ImageLeftAtOriginEvent) => void;

export type ParseErrorSource = ParseErrorEvent["source"];

export type ObservabilityDepBundle = {
	logger: Logger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	logCrawlSettled: LogCrawlSettled;
	logError: LogError;
	logInfo: LogInfo;
	logThumbnailNotDelivered: LogThumbnailNotDelivered;
	logImageLeftAtOrigin: LogImageLeftAtOrigin;
};

export function initObservabilityDepBundle(deps: {
	logger: Logger;
	source: ParseErrorSource;
	now: () => Date;
}): ObservabilityDepBundle {
	const logError: LogError = (message, error) =>
		deps.logger.error(formatErrorLogLine({ message, error, now: deps.now }));
	const logInfo: LogInfo = (message) => deps.logger.info(message);
	const { logParseError } = initLogParseError({
		logger: Logger.fromJSON<ParseErrorEvent>(),
		now: deps.now,
		source: deps.source,
	});
	const { logCrawlOutcome } = initLogCrawlOutcome({
		logger: Logger.fromJSON<CrawlOutcomeEvent>(),
		now: deps.now,
	});
	const { logCrawlSettled } = initLogCrawlSettled({
		logger: Logger.fromJSON<CrawlSettledEvent>(),
		now: deps.now,
	});
	return {
		logger: deps.logger,
		logParseError,
		logCrawlOutcome,
		logCrawlSettled,
		logError,
		logInfo,
		logThumbnailNotDelivered: Logger.fromJSON<ThumbnailNotDeliveredEvent>().warn,
		logImageLeftAtOrigin: Logger.fromJSON<ImageLeftAtOriginEvent>().warn,
	};
}
