import type { HutchLogger } from "@packages/hutch-logger";
import {
	PARSE_ERROR_STREAM,
	type ParseErrorEvent,
	initLogParseError,
} from "@packages/hutch-infra-components";

function createCapturingLogger(): {
	logger: HutchLogger.Typed<ParseErrorEvent>;
	captured: ParseErrorEvent[];
} {
	const captured: ParseErrorEvent[] = [];
	const logger: HutchLogger.Typed<ParseErrorEvent> = {
		info: (data) => { captured.push(data); },
		error: () => {},
		warn: () => {},
		debug: () => {},
	};
	return { logger, captured };
}

describe("initLogParseError", () => {
	it("emits a structured parse-failure event tagged with the configured source", () => {
		const { logger, captured } = createCapturingLogger();
		const { logParseError } = initLogParseError({
			logger,
			now: () => new Date("2026-04-19T10:30:00.000Z"),
			source: "save-link",
		});

		logParseError({
			url: "https://example.com/blocked",
			reason: "crawl-failed",
		});

		expect(captured).toHaveLength(1);
		expect(captured[0]).toEqual({
			stream: PARSE_ERROR_STREAM,
			event: "parse-failure",
			timestamp: "2026-04-19T10:30:00.000Z",
			url: "https://example.com/blocked",
			reason: "crawl-failed",
			source: "save-link",
		});
	});

	it("uses the source provided to the factory (e.g. for the tier-0 raw-html handler)", () => {
		const { logger, captured } = createCapturingLogger();
		const { logParseError } = initLogParseError({
			logger,
			now: () => new Date("2026-04-19T10:30:00.000Z"),
			source: "save-link-raw-html",
		});

		logParseError({ url: "https://example.com/x", reason: "parse-failed" });

		expect(captured[0]?.source).toBe("save-link-raw-html");
	});

	it("accepts a null url for failures that cannot resolve the request URL", () => {
		const { logger, captured } = createCapturingLogger();
		const { logParseError } = initLogParseError({
			logger,
			now: () => new Date("2026-04-19T10:30:00.000Z"),
			source: "hutch-handler",
		});

		logParseError({ url: null, reason: "payload-too-large" });

		expect(captured[0]).toEqual({
			stream: PARSE_ERROR_STREAM,
			event: "parse-failure",
			timestamp: "2026-04-19T10:30:00.000Z",
			url: null,
			reason: "payload-too-large",
			source: "hutch-handler",
		});
	});
});
