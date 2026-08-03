import { noopLogger } from "@packages/hutch-logger";
import { initObservabilityDepBundle } from "./observability";

describe("initObservabilityDepBundle", () => {
	it("returns a bundle with logger, logParseError, logCrawlOutcome, logError, and logInfo fields", () => {
		const bundle = initObservabilityDepBundle({
			logger: noopLogger,
			source: "save-link",
			now: () => new Date("2026-01-01T00:00:00Z"),
		});

		expect(bundle.logger).toBe(noopLogger);
		expect(typeof bundle.logParseError).toBe("function");
		expect(typeof bundle.logCrawlOutcome).toBe("function");
		expect(typeof bundle.logError).toBe("function");
		expect(typeof bundle.logInfo).toBe("function");
	});

	it("forwards logError calls to the injected logger as a single pure-JSON argument so Logs Insights can discover the fields", () => {
		const error = jest.fn();
		const logger = { ...noopLogger, error };
		const bundle = initObservabilityDepBundle({
			logger,
			source: "save-link",
			now: () => new Date("2026-01-01T00:00:00Z"),
		});

		const cause = new Error("boom");
		bundle.logError("widget exploded", cause);

		expect(error).toHaveBeenCalledTimes(1);
		expect(error.mock.calls[0]).toHaveLength(1);
		expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({
			level: "ERROR",
			timestamp: "2026-01-01T00:00:00.000Z",
			message: "widget exploded",
			name: "Error",
		});
	});

	it("keeps the message on a logError call with no Error so a bare crawler failure is not stored as an empty envelope", () => {
		const error = jest.fn();
		const logger = { ...noopLogger, error };
		const bundle = initObservabilityDepBundle({
			logger,
			source: "save-link",
			now: () => new Date("2026-01-01T00:00:00Z"),
		});

		bundle.logError("[CrawlArticle] HTTP 401 for https://example.com/a");

		expect(JSON.parse(error.mock.calls[0][0])).toEqual({
			level: "ERROR",
			timestamp: "2026-01-01T00:00:00.000Z",
			message: "[CrawlArticle] HTTP 401 for https://example.com/a",
		});
	});

	it("forwards logInfo calls to the injected logger so non-recoverable crawl outcomes stay out of the error stream", () => {
		const info = jest.fn();
		const logger = { ...noopLogger, info };
		const bundle = initObservabilityDepBundle({
			logger,
			source: "save-link",
			now: () => new Date(),
		});

		bundle.logInfo("origin returned HTTP 404");

		expect(info).toHaveBeenCalledWith("origin returned HTTP 404");
	});
});
