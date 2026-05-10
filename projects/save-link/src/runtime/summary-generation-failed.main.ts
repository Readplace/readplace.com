import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import type { ParseErrorEvent } from "@packages/hutch-infra-components";
import { initSummaryGenerationFailedHandler } from "../generate-summary/summary-generation-failed-handler";

export const handler = initSummaryGenerationFailedHandler({
	parseErrorLogger: HutchLogger.fromJSON<ParseErrorEvent>(),
	logger: HutchLogger.from(consoleLogger),
	now: () => new Date(),
});
