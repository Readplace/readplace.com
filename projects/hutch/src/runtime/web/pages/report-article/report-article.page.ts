import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type { FindEmailByUserId } from "@packages/provider-contracts/auth";
import type { SendEmail } from "@packages/provider-contracts/email";
import type { LogError } from "@packages/logger";
import {
	REPORT_ARTICLE_OPENED_PATH,
	REPORT_ARTICLE_PATH,
	REPORT_DETAILS_MAX_LENGTH,
	REPORT_REASONS,
	REPORT_SURFACES,
	renderReportArticleForm,
	renderReportArticleSent,
} from "../../shared/report-article/report-article-dialog.component";
import { buildReportArticleEmail, type Reporter } from "./report-article-email";

export const REPORT_SEND_FAILED_STATUS = 502;

function blankAsAbsent(value: unknown): unknown {
	return value === "" ? undefined : value;
}

const ReportArticleBodySchema = z.object({
	article: z.string(),
	title: z.string().max(1000),
	surface: z.enum(REPORT_SURFACES),
	reason: z.preprocess(blankAsAbsent, z.enum(REPORT_REASONS).optional()),
	details: z.preprocess(blankAsAbsent, z.string().max(REPORT_DETAILS_MAX_LENGTH).optional()),
	email: z.preprocess(blankAsAbsent, z.email().optional()),
});

interface ReportArticleDependencies {
	sendEmail: SendEmail;
	findEmailByUserId: FindEmailByUserId;
	appOrigin: string;
	logError: LogError;
}

function viewPathOf({ article, appOrigin }: { article: string; appOrigin: string }): string | undefined {
	if (!URL.canParse(article)) return undefined;
	const url = new URL(article);
	return url.origin === appOrigin && url.pathname.startsWith("/view/") ? `${url.pathname}${url.search}` : undefined;
}

async function reporterOf({
	req,
	givenEmail,
	findEmailByUserId,
}: { req: Request; givenEmail: string | undefined; findEmailByUserId: FindEmailByUserId }): Promise<Reporter> {
	if (req.userId !== undefined) {
		const email = await findEmailByUserId(req.userId);
		return email === null ? { kind: "anonymous" } : { kind: "account", email };
	}
	return givenEmail === undefined ? { kind: "anonymous" } : { kind: "given", email: givenEmail };
}

export function initReportArticleRoutes(deps: ReportArticleDependencies): Router {
	const router = express.Router();

	router.post(REPORT_ARTICLE_OPENED_PATH, (_req: Request, res: Response) => {
		res.status(204).end();
	});

	router.post(REPORT_ARTICLE_PATH, async (req: Request, res: Response) => {
		const parsed = ReportArticleBodySchema.safeParse(req.body);
		const viewPath = parsed.success ? viewPathOf({ article: parsed.data.article, appOrigin: deps.appOrigin }) : undefined;
		if (!parsed.success || viewPath === undefined) {
			res.status(400).type("text/plain").send("This report could not be read.");
			return;
		}
		const body = parsed.data;
		const reporter = await reporterOf({ req, givenEmail: body.email, findEmailByUserId: deps.findEmailByUserId });

		try {
			await deps.sendEmail(
				buildReportArticleEmail({
					articleUrl: body.article,
					title: body.title,
					reason: body.reason,
					details: body.details,
					reporter,
				}),
			);
		} catch (err) {
			deps.logError("[ReportArticle] Failed to send report email", err instanceof Error ? err : new Error(String(err)));
			res.status(REPORT_SEND_FAILED_STATUS).type("html").send(
				renderReportArticleForm({
					viewUrl: body.article,
					title: body.title,
					surface: body.surface,
					asksForEmail: req.userId === undefined,
					values: { reason: body.reason, details: body.details, email: body.email },
					failed: true,
				}),
			);
			return;
		}

		if (req.get("HX-Request") === "true") {
			res.type("html").send(renderReportArticleSent());
			return;
		}
		res.redirect(303, viewPath);
	});

	return router;
}
