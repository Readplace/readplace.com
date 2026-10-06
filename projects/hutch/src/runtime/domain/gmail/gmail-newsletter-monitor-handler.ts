import { z } from "zod";
import { UserIdSchema, type UserId } from "@packages/domain/user";
import { CheckGmailNewslettersCommand, GmailNewsletterAccountsCheckedEvent, MonitorGmailNewslettersCommand, GmailNewsletterMonitoringProgressedEvent } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { HutchLogger } from "@packages/hutch-logger";
import type { ListConnectedGmailAccounts } from "@packages/provider-contracts/gmail-account";
import type { Handler, SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from "aws-lambda";
import type { MonitorGmailNewsletters } from "./monitor-gmail-newsletters";

const RoutedEnvelope = z.discriminatedUnion("detail-type", [
	z.object({ "detail-type": z.literal(CheckGmailNewslettersCommand.detailType), detail: CheckGmailNewslettersCommand.detailSchema }),
	z.object({ "detail-type": z.literal(GmailNewsletterAccountsCheckedEvent.detailType), detail: GmailNewsletterAccountsCheckedEvent.detailSchema }),
	z.object({ "detail-type": z.literal(MonitorGmailNewslettersCommand.detailType), detail: MonitorGmailNewslettersCommand.detailSchema }),
	z.object({ "detail-type": z.literal(GmailNewsletterMonitoringProgressedEvent.detailType), detail: GmailNewsletterMonitoringProgressedEvent.detailSchema }),
]);

const Envelope = z.union([
	RoutedEnvelope,
	z.object({ "detail-type": z.undefined().optional(), detail: MonitorGmailNewslettersCommand.detailSchema }).transform((value) => ({ ...value, "detail-type": MonitorGmailNewslettersCommand.detailType })),
	z.object({ "detail-type": z.undefined().optional(), detail: CheckGmailNewslettersCommand.detailSchema.strict() }).transform((value) => ({ ...value, "detail-type": CheckGmailNewslettersCommand.detailType })),
]);

export function initGmailNewsletterMonitorHandler(deps: {
	monitor: MonitorGmailNewsletters;
	listConnectedAccounts: ListConnectedGmailAccounts;
	dispatchCheck: (input: { accountsPageToken?: string }) => Promise<void>;
	dispatchMonitor: (input: { userId: UserId; continuation?: { generation: string; page: number } }) => Promise<void>;
	dispatchNotice: (input: { userId: UserId }) => Promise<void>;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const envelope = Envelope.parse(JSON.parse(record.body));
				if (envelope["detail-type"] === CheckGmailNewslettersCommand.detailType) {
					const detail = CheckGmailNewslettersCommand.detailSchema.parse(envelope.detail);
					const accounts = await deps.listConnectedAccounts({ pageToken: detail.accountsPageToken });
					await deps.publishEvent(GmailNewsletterAccountsCheckedEvent, { userIds: accounts.userIds, nextAccountsPageToken: accounts.nextPageToken });
				} else if (envelope["detail-type"] === GmailNewsletterAccountsCheckedEvent.detailType) {
					const detail = GmailNewsletterAccountsCheckedEvent.detailSchema.parse(envelope.detail);
					for (const userId of detail.userIds) await deps.dispatchMonitor({ userId: UserIdSchema.parse(userId) });
					if (detail.nextAccountsPageToken !== undefined) await deps.dispatchCheck({ accountsPageToken: detail.nextAccountsPageToken });
				} else if (envelope["detail-type"] === MonitorGmailNewslettersCommand.detailType) {
					const detail = MonitorGmailNewslettersCommand.detailSchema.parse(envelope.detail);
					const userId = UserIdSchema.parse(detail.userId);
					const result = detail.continuation === undefined ? await deps.monitor.start(userId) : await deps.monitor.page({ userId, ...detail.continuation });
					await deps.publishEvent(GmailNewsletterMonitoringProgressedEvent, { userId, nextPage: result.nextPage, notices: result.notices });
				} else {
					const detail = GmailNewsletterMonitoringProgressedEvent.detailSchema.parse(envelope.detail);
					const userId = UserIdSchema.parse(detail.userId);
					if (detail.notices.length > 0) await deps.dispatchNotice({ userId });
					if (detail.nextPage !== undefined) await deps.dispatchMonitor({ userId, continuation: detail.nextPage });
				}
			} catch (error) {
				deps.logger.error("[gmail-newsletter-monitor] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
