import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { z } from "zod";
import { DiscoverGmailSendersPageCommand, GmailSenderDiscoveryProgressedEvent, StartGmailSenderDiscoveryCommand } from "@packages/hutch-infra-components";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type { GmailDiscoveryStore } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { DiscoverGmailSenders, GmailDiscoveryPage } from "./discover-gmail-senders";

const DiscoveryEnvelope = z.union([
	z.object({ "detail-type": z.literal(StartGmailSenderDiscoveryCommand.detailType), detail: StartGmailSenderDiscoveryCommand.detailSchema }).transform(({ detail }) => ({ kind: "start" as const, detail })),
	z.object({ "detail-type": z.literal(DiscoverGmailSendersPageCommand.detailType).optional(), detail: DiscoverGmailSendersPageCommand.detailSchema }).transform(({ detail }) => ({ kind: "page" as const, detail })),
	z.object({ "detail-type": z.literal(GmailSenderDiscoveryProgressedEvent.detailType), detail: GmailSenderDiscoveryProgressedEvent.detailSchema }).transform(({ detail }) => ({ kind: "progress" as const, detail })),
]);

export function initGmailDiscoveryHandler(deps: {
	discover: DiscoverGmailSenders;
	dispatchPage: (input: GmailDiscoveryPage) => Promise<void>;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const envelope = DiscoveryEnvelope.parse(JSON.parse(record.body));
				const userId = UserIdSchema.parse(envelope.detail.userId);
				if (envelope.kind === "progress") {
					const next = envelope.detail.nextPage;
					if (next !== undefined) await deps.dispatchPage({ userId, ...next });
					continue;
				}
				const nextPage = envelope.kind === "start"
					? await deps.discover.start(userId)
					: await deps.discover.page({ userId, generation: envelope.detail.generation, page: envelope.detail.page });
				await deps.publishEvent(GmailSenderDiscoveryProgressedEvent, { userId, nextPage });
			} catch (error) {
				deps.logger.error("[gmail-discovery] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}

export function initGmailDiscoveryDlqHandler(deps: {
	discovery: GmailDiscoveryStore;
	publishEvent: PublishEvent;
	logger: HutchLogger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];
		for (const record of event.Records) {
			try {
				const envelope = DiscoveryEnvelope.parse(JSON.parse(record.body));
				const userId = UserIdSchema.parse(envelope.detail.userId);
				const current = await deps.discovery.findDiscoveryByUserId(userId);
				if (current?.state !== "running") continue;
				const expected = envelope.kind === "page"
					? envelope.detail
					: envelope.kind === "progress" ? envelope.detail.nextPage : undefined;
				if (expected !== undefined && (current.generation !== expected.generation || current.page !== expected.page)) continue;
				await deps.discovery.failDiscovery({ userId, generation: current.generation, error: "Gmail sender loading paused. Try again to continue." });
				await deps.publishEvent(GmailSenderDiscoveryProgressedEvent, { userId });
			} catch (error) {
				deps.logger.error("[gmail-discovery-dlq] record failed", { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}
		return { batchItemFailures };
	};
}
