import { consoleLogger } from "@packages/hutch-logger";
import { initSummaryGeneratedHandler } from "./domain/generate-summary/summary-generated-handler";

export const handler = initSummaryGeneratedHandler({
	logger: consoleLogger,
});
