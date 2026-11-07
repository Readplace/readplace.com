import assert from "node:assert";
import { SaveProvenanceSchema } from "@packages/domain/article";
import { EventEnvelope } from "@packages/domain/event-envelope";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug, ReadlistSlugSchema } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import {
	ArticleFiledIntoReadlistEvent,
	type FileArticleIntoReadlistDetail,
	FileArticleIntoReadlistCommand,
} from "@packages/infra-components";
import { initSqsRecordHandler, type PublishEvent } from "@packages/infra-components/runtime";
import type { Logger } from "@packages/logger";
import type { FindSavedArticleForLink, ListReadlistDefinitions } from "@packages/provider-contracts/article-store";
import type { FileRequestedArticleIntoReadlist } from "@packages/save-article";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";

export class ArticleNotYetSavedError extends Error {
	readonly userId: UserId;
	readonly readlist: ReadlistSlug;
	readonly source: FileArticleIntoReadlistDetail["fit"]["source"];

	constructor(input: {
		userId: UserId;
		readlist: ReadlistSlug;
		source: FileArticleIntoReadlistDetail["fit"]["source"];
	}) {
		super("[file-article-into-readlist] the link's article is not in All yet");
		this.name = "ArticleNotYetSavedError";
		this.userId = input.userId;
		this.readlist = input.readlist;
		this.source = input.source;
	}
}

export function initFileArticleIntoReadlistCommandHandler(deps: {
	findSavedArticleForLink: FindSavedArticleForLink;
	listReadlistDefinitions: ListReadlistDefinitions;
	fileRequestedArticleIntoReadlist: FileRequestedArticleIntoReadlist;
	publishEvent: PublishEvent;
	logger: Logger;
}): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: FileArticleIntoReadlistCommand,
		logger: deps.logger,
		failure: {
			report: ({ record, error }) => {
				if (error instanceof ArticleNotYetSavedError) {
					deps.logger.info("[file-article-into-readlist] waiting for the article to reach All; redelivery scheduled", {
						userId: error.userId,
						readlist: error.readlist,
						messageId: record.messageId,
						receiveCount: record.receiveCount,
						...(error.source.kind === "email"
							? { receivedAtMessageId: error.source.receivedAtMessageId, ordinal: error.source.ordinal }
							: {}),
					});
				} else {
					deps.logger.error(
						`[file-article-into-readlist] record failed on receive ${record.receiveCount} (messageId ${record.messageId})`,
						{ error },
					);
				}
			},
		},
		malformed: { policy: "retry" },
		handle: async (detail, record) => {
			const { userId } = detail;
			const readlist = ReadlistSlugSchema.parse(detail.readlist);
			assert(readlist !== DEFAULT_READLIST_SLUG, "All is never a filing target");
			const provenance = SaveProvenanceSchema.parse(detail.provenance);
			const requestedAt = new Date(EventEnvelope.parse(JSON.parse(record.body)).time);
			const skip = (reason: string) =>
				deps.logger.info("[file-article-into-readlist] filing skipped", {
					userId,
					readlist,
					messageId: record.messageId,
					reason,
				});

			const definitions = await deps.listReadlistDefinitions(userId);
			if (!definitions.some((definition) => definition.slug === readlist)) {
				skip("readlist-gone");
				return;
			}
			const found = await deps.findSavedArticleForLink({ userId, url: detail.url });
			if (found.kind === "not-saved") {
				throw new ArticleNotYetSavedError({ userId, readlist, source: detail.fit.source });
			}
			const filing = await deps.fileRequestedArticleIntoReadlist({
				userId,
				readlist,
				article: found.article,
				provenance,
				source: detail.fit.source,
				requestedAt,
			});
			if (filing.kind === "not-in-all") {
				throw new ArticleNotYetSavedError({ userId, readlist, source: detail.fit.source });
			}
			if (filing.kind === "skipped") {
				skip(filing.reason);
				return;
			}
			await deps.publishEvent(ArticleFiledIntoReadlistEvent, {
				userId,
				readlist,
				url: found.resolvedUrl,
				source: detail.fit.source,
			});
		},
	});
}
