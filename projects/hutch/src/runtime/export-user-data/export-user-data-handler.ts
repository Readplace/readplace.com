import { READPLACE_SENDER, REPLY_TO } from "../email-senders";
import assert from "node:assert";
import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import {
	ExportUserDataCommand,
	type ExportUserDataDetail,
	UserDataExportedEvent,
	UserDataExportSkippedEvent,
	type UserDataExportSkipReason,
} from "@packages/infra-components";
import {
	initSqsRecordHandler,
	type PublishEvent,
} from "@packages/infra-components/runtime";
import type {
	FindArticlesAcrossReadlists,
	FindOriginalUrls,
	ForEachHeldLinkPage,
} from "@packages/provider-contracts/article-store";
import type { ListReadlistDefinitions } from "@packages/provider-contracts/article-store";
import type { EngagementStarterState } from "@packages/provider-contracts/engagement-starter";
import type { ReadCanonicalSnapshot } from "@packages/provider-contracts/canonical-snapshot";
import type { ListAllUserHighlights } from "@packages/provider-contracts/highlights";
import type { FindExportRecipient, MarkExportDelivered } from "@packages/provider-contracts/auth";
import type { SendEmail } from "@packages/provider-contracts/email";
import type {
	DeleteUserExports,
	UploadUserDataExport,
} from "../providers/user-data-export/user-data-export.types";
import { decideExportDelivery } from "./decide-export-delivery";
import {
	type ExportEnvelope,
	toExportArticle,
	toExportRemovedArticle,
} from "../web/pages/export/build-export-record";
import { groupHighlightsByArticle, toExportHighlights } from "../web/pages/export/build-export-highlight";
import { EXPORT_DOWNLOAD_TTL_DAYS } from "../web/pages/export/export-ttl";
import { buildUserDataExportEmailHtml } from "../web/pages/export/user-data-export-email";

const PAGE_SIZE = 500;

export interface ExportUserDataDependencies {
	exportBulkArticles?: ReturnType<typeof import("../bulk-articles/selection-store").initExportBulkArticles>;
	engagementState: Pick<EngagementStarterState, "findEngagement" | "findStarterPack">;
	listReadlistDefinitions: ListReadlistDefinitions;
	findArticlesAcrossReadlists: FindArticlesAcrossReadlists;
	listAllUserHighlights: ListAllUserHighlights;
	readCanonicalSnapshot: ReadCanonicalSnapshot;
	forEachHeldLinkPage: ForEachHeldLinkPage;
	findOriginalUrls: FindOriginalUrls;
	uploadUserDataExport: UploadUserDataExport;
	deleteUserExports: DeleteUserExports;
	findExportRecipient: FindExportRecipient;
	markExportDelivered: MarkExportDelivered;
	sendEmail: SendEmail;
	publishEvent: PublishEvent;
	logger: Logger;
	now: () => Date;
}

export function initExportUserDataHandler(
	deps: ExportUserDataDependencies,
): Handler<SQSEvent, SQSBatchResponse> {
	return initSqsRecordHandler({
		definition: ExportUserDataCommand,
		logger: deps.logger,
		failure: { message: "[ExportUserData] record failed" },
		malformed: { policy: "retry" },
		handle: (detail) => processCommand(detail, deps),
	});
}

async function processCommand(
	detail: ExportUserDataDetail,
	deps: ExportUserDataDependencies,
): Promise<void> {
	const { userId, requestedAt } = detail;
	deps.logger.info("[ExportUserData] starting export", { userId: detail.userId });

	const beforeExport = decideExportDelivery({
		recipient: await deps.findExportRecipient(userId),
		requestedAt,
	});
	if (beforeExport.outcome === "refused") {
		await finishAsRefused({ detail, reason: beforeExport.reason, deps });
		return;
	}

	const highlightsByArticle = groupHighlightsByArticle(await deps.listAllUserHighlights(userId));
	const articles: ExportEnvelope["articles"] = [];
	let page = 1;
	while (true) {
		const result = await deps.findArticlesAcrossReadlists({
			userId,
			page,
			pageSize: PAGE_SIZE,
			order: "asc",
			excludeContent: true,
		});
		for (const article of result.articles) {
			const exported = toExportArticle(article);
			const rows = highlightsByArticle.get(ArticleResourceUniqueId.parse(article.url).value);
			if (rows === undefined) {
				articles.push(exported);
				continue;
			}
			const snapshot = await deps.readCanonicalSnapshot(article.url);
			const highlights = toExportHighlights({ highlights: rows, contentHash: snapshot?.canonicalContentHash });
			articles.push({ ...exported, highlights });
		}
		deps.logger.info("[ExportUserData] fetched articles page", {
			userId: detail.userId,
			page,
			pageSize: PAGE_SIZE,
			pageRows: result.articles.length,
			fetched: articles.length,
		});
		if (result.articles.length === 0) break;
		page++;
	}

	const removedArticles: ExportEnvelope["removedArticles"] = [];
	await deps.forEachHeldLinkPage({
		userId,
		now: deps.now(),
		onPage: async (links) => {
			const originals = await deps.findOriginalUrls({ storedKeys: links.map((link) => link.storedKey) });
			for (const link of links) {
				const originalUrl = originals.get(link.storedKey);
				assert(originalUrl, "a held link's article row carries its original URL");
				removedArticles.push(toExportRemovedArticle({ link, originalUrl }));
			}
		},
	});

	const exportedAt = deps.now().toISOString();
	const envelope: ExportEnvelope = {
		engagement: await deps.engagementState.findEngagement(userId),
		starterPack: await deps.engagementState.findStarterPack(userId),
		readlists: await deps.listReadlistDefinitions(userId),
		exportedAt,
		articleCount: articles.length,
		articles,
		removedArticles,
		...(deps.exportBulkArticles ? { bulkArticles: await deps.exportBulkArticles(userId, deps.now()) } : {}),
	};
	const body = JSON.stringify(envelope, null, 2);

	const { s3Key, downloadUrl } = await deps.uploadUserDataExport({
		userId,
		body,
	});
	deps.logger.info("[ExportUserData] uploaded export to S3", {
		userId: detail.userId,
		s3Key,
		bodyBytes: body.length,
	});

	const beforeSend = decideExportDelivery({
		recipient: await deps.findExportRecipient(userId),
		requestedAt,
	});
	if (beforeSend.outcome === "refused") {
		await finishAsRefused({ detail, reason: beforeSend.reason, deps });
		return;
	}

	await deps.sendEmail({
		from: READPLACE_SENDER,
		replyTo: REPLY_TO,
		to: beforeSend.email,
		subject: "Your Readplace export is ready",
		html: buildUserDataExportEmailHtml({
			downloadUrl,
			articleCount: articles.length,
			ttlDays: EXPORT_DOWNLOAD_TTL_DAYS,
		}),
	});
	deps.logger.info("[ExportUserData] sent email", {
		userId: detail.userId,
	});

	await deps.markExportDelivered({ userId, email: beforeSend.email, requestedAt });

	await deps.publishEvent(UserDataExportedEvent, {
		userId: detail.userId,
		articleCount: articles.length,
		s3Key,
		exportedAt,
	});

	deps.logger.info("[ExportUserData] export completed", {
		userId: detail.userId,
		articleCount: articles.length,
		s3Key,
	});
}

async function finishAsRefused(input: {
	detail: ExportUserDataDetail;
	reason: UserDataExportSkipReason;
	deps: ExportUserDataDependencies;
}): Promise<void> {
	const { detail, reason, deps } = input;
	if (reason !== "already-delivered") await deps.deleteUserExports(detail.userId);
	await deps.publishEvent(UserDataExportSkippedEvent, {
		userId: detail.userId,
		requestedAt: detail.requestedAt,
		reason,
	});
	deps.logger.info("[ExportUserData] export skipped", {
		userId: detail.userId,
		reason,
	});
}
