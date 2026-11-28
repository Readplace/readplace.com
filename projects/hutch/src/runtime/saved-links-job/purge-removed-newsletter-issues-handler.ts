import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { PurgeArticleContent, TombstoneArticle } from "@packages/article-store";
import { heldLinkExpiresAt } from "@packages/domain/article";
import {
	type EmailIdentityStore,
	emailImageS3KeyPrefix,
	emailIssueArticleUrl,
	emailIssueStoredKey,
	type InboxEmailLinkStore,
	type InboxEmailStore,
	type RemovableInboxEmail,
} from "@packages/domain/inbox";
import { PurgeRemovedNewsletterIssuesCommand, RemovedNewsletterIssuesPurgedEvent } from "@packages/infra-components";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type { FindKeysInAll } from "@packages/provider-contracts/article-store";

export function initPurgeRemovedNewsletterIssuesHandler(deps: {
	forEachRemovableEmailPage: InboxEmailStore["forEachRemovableEmailPage"];
	clearEmailRemoval: InboxEmailStore["clearEmailRemoval"];
	deleteEmail: InboxEmailStore["deleteEmail"];
	findKeysInAll: FindKeysInAll;
	deleteRawEmailObjects: (keys: string[]) => Promise<void>;
	deleteEmailContentObjects: (keys: string[]) => Promise<void>;
	deleteEmailImageObjects: (prefixes: string[]) => Promise<void>;
	deleteLinksByEmails: InboxEmailLinkStore["deleteAllLinksByUserId"];
	deleteIdentitiesByEmails: EmailIdentityStore["deleteByEmails"];
	purgeArticleContent: PurgeArticleContent;
	tombstoneArticle: TombstoneArticle;
	publishEvent: PublishEvent;
	logger: Logger;
	now: () => Date;
}): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: PurgeRemovedNewsletterIssuesCommand,
		logger: deps.logger,
		failure: { message: "[purge-removed-newsletter-issues] record failed" },
		malformed: { policy: "retry" },
		handle: async ({ userId }) => {
			const now = deps.now();
			const due: RemovableInboxEmail[] = [];
			await deps.forEachRemovableEmailPage({
				userId,
				onPage: async (emails) => {
					for (const email of emails) {
						if (email.removal !== undefined && heldLinkExpiresAt(email.removal.removedAt).getTime() <= now.getTime()) {
							due.push(email);
						}
					}
				},
			});
			const issueKeyOf = (email: RemovableInboxEmail) =>
				emailIssueStoredKey({ userId, receivedAtMessageId: email.receivedAtMessageId });
			const inAll = await deps.findKeysInAll({ userId, storedKeys: due.map(issueKeyOf) });
			const restored = due.filter((email) => inAll.has(issueKeyOf(email)));
			const purged = due.filter((email) => !inAll.has(issueKeyOf(email)));
			for (const email of restored) {
				await deps.clearEmailRemoval({ userId, receivedAtMessageId: email.receivedAtMessageId });
			}
			const receivedAtMessageIds = purged.map((email) => email.receivedAtMessageId);
			await deps.deleteRawEmailObjects(purged.map((email) => email.rawEmailS3Key));
			await deps.deleteEmailContentObjects(purged.flatMap((email) => (email.bodyS3Key === undefined ? [] : [email.bodyS3Key])));
			await deps.deleteEmailImageObjects(
				receivedAtMessageIds.map((receivedAtMessageId) => emailImageS3KeyPrefix({ userId, receivedAtMessageId })),
			);
			await deps.deleteLinksByEmails(userId, receivedAtMessageIds);
			await deps.deleteIdentitiesByEmails({ userId, receivedAtMessageIds });
			for (const receivedAtMessageId of receivedAtMessageIds) {
				const url = emailIssueArticleUrl({ userId, receivedAtMessageId });
				await deps.purgeArticleContent(url);
				await deps.tombstoneArticle({ url, at: now });
			}
			for (const receivedAtMessageId of receivedAtMessageIds) {
				await deps.deleteEmail({ userId, receivedAtMessageId });
			}
			deps.logger.info("[purge-removed-newsletter-issues] purged", { deleted: purged.length, restored: restored.length });
			await deps.publishEvent(RemovedNewsletterIssuesPurgedEvent, {
				userId,
				deleted: purged.length,
				restored: restored.length,
				purgedAt: now.toISOString(),
			});
		},
	});
}
