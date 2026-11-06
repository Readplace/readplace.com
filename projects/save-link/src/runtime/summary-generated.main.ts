import { consoleLogger } from "@packages/logger";
import { initSummaryGeneratedHandler } from "./domain/generate-summary/summary-generated-handler";

export const handler = initSummaryGeneratedHandler({
	logger: consoleLogger,
});
