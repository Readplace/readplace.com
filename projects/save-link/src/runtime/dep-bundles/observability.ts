import { HutchLogger } from "@packages/hutch-logger";
import {
	initLogParseError,
	initLogCrawlOutcome,
	type ParseErrorEvent,
	type CrawlOutcomeEvent,
	type LogParseError,
	type LogCrawlOutcome,
} from "@packages/hutch-infra-components";

export type LogError = (message: string, error?: Error) => void;

export type ParseErrorSource = ParseErrorEvent["source"];

export type ObservabilityDepBundle = {
	logger: HutchLogger;
	logParseError: LogParseError;
	logCrawlOutcome: LogCrawlOutcome;
	logError: LogError;
};

export function initObservabilityDepBundle(deps: {
	logger: HutchLogger;
	source: ParseErrorSource;
	now: () => Date;
}): ObservabilityDepBundle {
	const logError: LogError = (message, error) => deps.logger.error(message, { error });
	const { logParseError } = initLogParseError({
		logger: HutchLogger.fromJSON<ParseErrorEvent>(),
		now: deps.now,
		source: deps.source,
	});
	const { logCrawlOutcome } = initLogCrawlOutcome({
		logger: HutchLogger.fromJSON<CrawlOutcomeEvent>(),
		now: deps.now,
	});
	return { logger: deps.logger, logParseError, logCrawlOutcome, logError };
}
