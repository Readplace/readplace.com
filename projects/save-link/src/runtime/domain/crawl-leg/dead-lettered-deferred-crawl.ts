import { ComprehensiveCrawlCommand } from "@packages/infra-components";

export const DeadLetteredDeferredCrawl = {
	detailSchema: ComprehensiveCrawlCommand.detailSchema
		.pick({ url: true, saveAttemptId: true, candidates: true, userId: true, trigger: true })
		.partial({ trigger: true }),
};
