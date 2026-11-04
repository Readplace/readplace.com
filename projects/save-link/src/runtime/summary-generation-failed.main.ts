import { Logger, consoleLogger } from "@packages/logger";
import type { ParseErrorEvent } from "@packages/infra-components";
import { initSummaryGenerationFailedHandler } from "./domain/generate-summary/summary-generation-failed-handler";

export const handler = initSummaryGenerationFailedHandler({
	parseErrorLogger: Logger.fromJSON<ParseErrorEvent>(),
	logger: Logger.from(consoleLogger),
	now: () => new Date(),
});
