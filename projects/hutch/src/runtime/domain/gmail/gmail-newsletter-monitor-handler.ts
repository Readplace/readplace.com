import { z } from "zod";
import type { UserId } from "@packages/domain/user";
import { CheckGmailNewslettersCommand, GmailNewsletterAccountsCheckedEvent, MonitorGmailNewslettersCommand, GmailNewsletterMonitoringProgressedEvent } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type { ListConnectedGmailAccounts } from "@packages/provider-contracts/gmail-account";
import { type GetEffectiveAccess, hasPaidFeatures } from "@packages/subscription-access";
import type { Handler, SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from "aws-lambda";
import type { MonitorGmailNewsletters } from "./monitor-gmail-newsletters";

const Envelope = z.union([
	z.object({ "detail-type": z.literal(CheckGmailNewslettersCommand.detailType), detail: CheckGmailNewslettersCommand.detailSchema }).transform(({ detail }) => ({ kind: "check" as const, detail })),
	z.object({ "detail-type": z.literal(GmailNewsletterAccountsCheckedEvent.detailType), detail: GmailNewsletterAccountsCheckedEvent.detailSchema }).transform(({ detail }) => ({ kind: "checked" as const, detail })),
	z.object({ "detail-type": z.literal(MonitorGmailNewslettersCommand.detailType), detail: MonitorGmailNewslettersCommand.detailSchema }).transform(({ detail }) => ({ kind: "monitor" as const, detail })),
	z.object({ "detail-type": z.literal(GmailNewsletterMonitoringProgressedEvent.detailType), detail: GmailNewsletterMonitoringProgressedEvent.detailSchema }).transform(({ detail }) => ({ kind: "progressed" as const, detail })),
	z.object({ "detail-type": z.undefined().optional(), detail: MonitorGmailNewslettersCommand.detailSchema }).transform(({ detail }) => ({ kind: "monitor" as const, detail })),
	z.object({ "detail-type": z.undefined().optional(), detail: CheckGmailNewslettersCommand.detailSchema.strict() }).transform(({ detail }) => ({ kind: "check" as const, detail })),
]);

export function initGmailNewsletterMonitorHandler(deps: {
	monitor: MonitorGmailNewsletters;
	listConnectedAccounts: ListConnectedGmailAccounts;
	getEffectiveAccess: GetEffectiveAccess;
	dispatchCheck: (input: { accountsPageToken?: string }) => Promise<void>;
	dispatchMonitor: (input: { userId: UserId; continuation?: { generation: string; page: number } }) => Promise<void>;
	dispatchNotice: (input: { userId: UserId }) => Promise<void>;
	publishEvent: PublishEvent;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const envelope = Envelope.parse(JSON.parse(record.body));
				switch (envelope.kind) {
					case "check": {
						const accounts = await deps.listConnectedAccounts({ pageToken: envelope.detail.accountsPageToken });
						await deps.publishEvent(GmailNewsletterAccountsCheckedEvent, { userIds: accounts.userIds, nextAccountsPageToken: accounts.nextPageToken });
						break;
					}
					case "checked": {
						const { detail } = envelope;
						for (const userId of detail.userIds) await deps.dispatchMonitor({ userId });
						if (detail.nextAccountsPageToken !== undefined) await deps.dispatchCheck({ accountsPageToken: detail.nextAccountsPageToken });
						break;
					}
					case "monitor": {
						const { userId, continuation } = envelope.detail;
						if (!hasPaidFeatures(await deps.getEffectiveAccess(userId))) {
							deps.logger.info("[gmail-newsletter-monitor] skipped free-plan account", { messageId: record.messageId });
							break;
						}
						const result = continuation === undefined ? await deps.monitor.start(userId) : await deps.monitor.page({ userId, ...continuation });
						await deps.publishEvent(GmailNewsletterMonitoringProgressedEvent, { userId, nextPage: result.nextPage, notices: result.notices });
						break;
					}
					case "progressed": {
						const { userId, notices, nextPage } = envelope.detail;
						if (notices.length > 0) await deps.dispatchNotice({ userId });
						if (nextPage !== undefined) await deps.dispatchMonitor({ userId, continuation: nextPage });
						break;
					}
				}
			} catch (error) {
				deps.logger.error("[gmail-newsletter-monitor] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
