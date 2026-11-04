import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { deriveEmailIssueMetadata, emailIssueArticleUrl, emailIssueReceivedAt } from "@packages/domain/inbox";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { UserIdSchema } from "@packages/domain/user";
import { EmailOutputSavedToAllEvent, SaveEmailIssueCommand } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type { ContentProvider } from "@packages/provider-contracts/article-store";
import type { RecordInboxArticleQueued } from "@packages/provider-contracts/onboarding-signals";
import type { Handler, SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { PutTierSource } from "@packages/tier-source";
import { initCommitTierCandidate } from "../crawl-leg/commit-tier-candidate";
import type { SaveEmailIssue } from "./save-email-issue";

const LOG_PREFIX = "[SaveEmailIssueCommand]";

export function initSaveEmailIssueCommandHandler(deps: {
	readEmailBody: ContentProvider;
	saveEmailIssue: SaveEmailIssue;
	putTierSource: PutTierSource;
	recordInboxArticleQueued: RecordInboxArticleQueued;
	publishEvent: PublishEvent;
	now: () => Date;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	const { logger } = deps;
	const commitTierCandidate = initCommitTierCandidate(deps);

	return async (event): Promise<SQSBatchResponse> => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const detail = SaveEmailIssueCommand.detailSchema.parse(JSON.parse(record.body).detail);
				const userId = UserIdSchema.parse(detail.userId);
				const url = emailIssueArticleUrl({ userId, receivedAtMessageId: detail.receivedAtMessageId });
				const body = await deps.readEmailBody(ArticleResourceUniqueId.parse(url));
				assert(body !== undefined, `${LOG_PREFIX} an email's body is stored before its issue is saved`);
				const { estimatedReadTime, ...metadata } = deriveEmailIssueMetadata({
					subject: detail.subject,
					senderEmail: detail.senderEmail,
					senderName: detail.senderName,
					html: body,
					receivedAt: emailIssueReceivedAt(detail.receivedAtMessageId),
				});
				const { contentPending } = await deps.saveEmailIssue({
					userId,
					url,
					displayUrl: detail.issueUrl,
					metadata,
					estimatedReadTime,
					provenance: { kind: "email", senderEmail: detail.senderEmail },
					readlists: detail.readlists.map((readlist) => ReadlistSlugSchema.parse(readlist)),
					onSavedToAll: async () => {
						if (detail.emailOutput === undefined) return;
						await deps.publishEvent(EmailOutputSavedToAllEvent, { userId, ...detail.emailOutput });
					},
				});
				if (contentPending) {
					const extractedAt = deps.now().toISOString();
					await commitTierCandidate({
						url,
						attemptId: detail.saveAttemptId,
						originalUrl: detail.issueUrl,
						sourceUrl: url,
						fetchedAt: extractedAt,
						leg: { tier: "tier-0", kind: "extension", captureTrigger: undefined },
						metadata: { ...metadata, estimatedReadTime },
						html: body,
						evaluation: { hashed: body, stored: undefined },
						crawlOutcome: { report: "none" },
						announce: { event: "tier-content-extracted", userId, extractedAt: () => extractedAt },
					});
				}
				try {
					await deps.recordInboxArticleQueued({ userId });
				} catch (error) {
					logger.warn(`${LOG_PREFIX} inbox onboarding stamp failed — continuing`, {
						receivedAtMessageId: detail.receivedAtMessageId,
						error: String(error),
					});
				}
				logger.info(`${LOG_PREFIX} saved`, { receivedAtMessageId: detail.receivedAtMessageId, contentPending });
			} catch (error) {
				logger.error(`${LOG_PREFIX} record failed`, { messageId: record.messageId, error });
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
