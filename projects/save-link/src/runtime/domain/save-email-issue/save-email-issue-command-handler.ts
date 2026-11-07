import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { EventEnvelope } from "@packages/domain/event-envelope";
import { deriveEmailIssueMetadata, emailIssueArticleUrl, emailIssueReceivedAt } from "@packages/domain/inbox";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { EmailIssueSaveSkippedEvent, EmailOutputSavedToAllEvent, SaveEmailIssueCommand } from "@packages/infra-components";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type { ContentProvider } from "@packages/provider-contracts/article-store";
import type { RecordInboxArticleQueued } from "@packages/provider-contracts/onboarding-signals";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
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

	return initSqsRecordHandler({
		definition: SaveEmailIssueCommand,
		logger,
		failure: { message: `${LOG_PREFIX} record failed` },
		malformed: { policy: "retry" },
		handle: async (detail, record) => {
			const { userId, receivedAtMessageId } = detail;
			const requestedAt = new Date(EventEnvelope.parse(JSON.parse(record.body)).time);
			const url = emailIssueArticleUrl({ userId, receivedAtMessageId });
			const body = await deps.readEmailBody(ArticleResourceUniqueId.parse(url));
			if (body === undefined) {
				logger.warn(`${LOG_PREFIX} save skipped: the email's body is gone`, { receivedAtMessageId });
				await deps.publishEvent(EmailIssueSaveSkippedEvent, { userId, receivedAtMessageId, reason: "body-gone" });
				return;
			}
			const { estimatedReadTime, ...metadata } = deriveEmailIssueMetadata({
				subject: detail.subject,
				senderEmail: detail.senderEmail,
				senderName: detail.senderName,
				html: body,
				receivedAt: emailIssueReceivedAt(receivedAtMessageId),
			});
			const outcome = await deps.saveEmailIssue({
				userId,
				url,
				displayUrl: detail.issueUrl,
				metadata,
				estimatedReadTime,
				provenance: { kind: "email", senderEmail: detail.senderEmail },
				readlists: detail.readlists.map((readlist) => ReadlistSlugSchema.parse(readlist)),
				requestedAt,
				onSavedToAll: async () => {
					if (detail.emailOutput === undefined) return;
					await deps.publishEvent(EmailOutputSavedToAllEvent, { userId, ...detail.emailOutput });
				},
			});
			if (outcome.kind === "write-access-lapsed") {
				logger.warn("[save-email-issue] save refused", {
					userId,
					receivedAtMessageId,
					messageId: record.messageId,
					reason: "write-access-lapsed",
				});
				await deps.publishEvent(EmailIssueSaveSkippedEvent, { userId, receivedAtMessageId, reason: "write-access-lapsed" });
				return;
			}
			if (outcome.kind === "saved") {
				for (const filing of outcome.filings) {
					if (filing.outcome === "filed" || filing.outcome === "already-filed" || filing.outcome === "newer-row-won") continue;
					logger.info("[save-email-issue] filing skipped", {
						userId,
						readlist: filing.readlist,
						receivedAtMessageId,
						messageId: record.messageId,
						reason: filing.outcome,
					});
				}
			}
			const { contentPending } = outcome;
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
			if (outcome.kind === "removed-by-reader") {
				await deps.publishEvent(EmailIssueSaveSkippedEvent, { userId, receivedAtMessageId, reason: "removed-by-reader" });
			}
			try {
				await deps.recordInboxArticleQueued({ userId });
			} catch (error) {
				logger.warn(`${LOG_PREFIX} inbox onboarding stamp failed — continuing`, {
					receivedAtMessageId,
					error: String(error),
				});
			}
			logger.info(`${LOG_PREFIX} saved`, { receivedAtMessageId, contentPending });
		},
	});
}
