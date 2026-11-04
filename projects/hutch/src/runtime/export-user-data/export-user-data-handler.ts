import type { Handler, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { Logger } from "@packages/logger";
import {
	ExportUserDataCommand,
	type ExportUserDataDetail,
	UserDataExportedEvent,
} from "@packages/infra-components";
import {
	initSqsRecordHandler,
	type PublishEvent,
} from "@packages/infra-components/runtime";
import type { FindArticlesAcrossReadlists } from "@packages/provider-contracts/article-store";
import type { ListReadlistDefinitions } from "@packages/provider-contracts/article-store";
import type { EngagementStarterState } from "@packages/provider-contracts/engagement-starter";
import type { SendEmail } from "@packages/provider-contracts/email";
import type { UploadUserDataExport } from "../providers/user-data-export/user-data-export.types";
import {
	type ExportEnvelope,
	toExportArticle,
} from "../web/pages/export/build-export-record";
import { EXPORT_DOWNLOAD_TTL_DAYS } from "../web/pages/export/export-ttl";
import { buildUserDataExportEmailHtml } from "../web/pages/export/user-data-export-email";

const EMAIL_FROM = "Readplace <readplace@readplace.com>";
const EMAIL_REPLY_TO = "fayner@readplace.com";
const PAGE_SIZE = 500;

export interface ExportUserDataDependencies {
	engagementState: Pick<EngagementStarterState, "findEngagement" | "findStarterPack">;
	listReadlistDefinitions: ListReadlistDefinitions;
	findArticlesAcrossReadlists: FindArticlesAcrossReadlists;
	uploadUserDataExport: UploadUserDataExport;
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
	const { userId } = detail;
	deps.logger.info("[ExportUserData] starting export", { userId: detail.userId });

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
		for (const article of result.articles) articles.push(toExportArticle(article));
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

	const exportedAt = deps.now().toISOString();
	const envelope: ExportEnvelope = {
		engagement: await deps.engagementState.findEngagement(userId),
		starterPack: await deps.engagementState.findStarterPack(userId),
		readlists: await deps.listReadlistDefinitions(userId),
		exportedAt,
		articleCount: articles.length,
		articles,
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

	await deps.sendEmail({
		from: EMAIL_FROM,
		replyTo: EMAIL_REPLY_TO,
		to: detail.email,
		subject: "Your Readplace export is ready",
		html: buildUserDataExportEmailHtml({
			downloadUrl,
			articleCount: articles.length,
			ttlDays: EXPORT_DOWNLOAD_TTL_DAYS,
		}),
	});
	deps.logger.info("[ExportUserData] sent email", {
		userId: detail.userId,
		to: detail.email,
	});

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
