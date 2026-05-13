import { noopLogger } from "@packages/hutch-logger";
import { initObservabilityDepBundle } from "./observability";

describe("initObservabilityDepBundle", () => {
	it("returns a bundle with logger, logParseError, logCrawlOutcome, and logError fields", () => {
		const bundle = initObservabilityDepBundle({
			logger: noopLogger,
			source: "save-link",
			now: () => new Date("2026-01-01T00:00:00Z"),
		});

		expect(bundle.logger).toBe(noopLogger);
		expect(typeof bundle.logParseError).toBe("function");
		expect(typeof bundle.logCrawlOutcome).toBe("function");
		expect(typeof bundle.logError).toBe("function");
	});

	it("forwards logError calls to the injected logger so the production console logger captures bundle-internal errors", () => {
		const error = jest.fn();
		const logger = { ...noopLogger, error };
		const bundle = initObservabilityDepBundle({
			logger,
			source: "save-link",
			now: () => new Date(),
		});

		const cause = new Error("boom");
		bundle.logError("widget exploded", cause);

		expect(error).toHaveBeenCalledWith("widget exploded", { error: cause });
	});
});
