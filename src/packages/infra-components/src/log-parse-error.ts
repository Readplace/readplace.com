import { PARSE_ERROR_STREAM, type ParseErrorEvent } from "./logs";

export type LogParseError = (params: { url: string | null; reason: string }) => void;

export function initLogParseError(deps: {
	logger: { info: (event: ParseErrorEvent) => void };
	now: () => Date;
	source: ParseErrorEvent["source"];
}): { logParseError: LogParseError } {
	const logParseError: LogParseError = (params) => {
		deps.logger.info({
			stream: PARSE_ERROR_STREAM,
			event: "parse-failure",
			timestamp: deps.now().toISOString(),
			url: params.url,
			reason: params.reason,
			source: deps.source,
		});
	};
	return { logParseError };
}
