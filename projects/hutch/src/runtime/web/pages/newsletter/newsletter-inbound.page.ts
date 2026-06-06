import express, { type Request, type Response, type Router } from "express";
import {
	INBOUND_EMAIL_RECEIVED_TYPE,
	InboundEmailWebhookSchema,
	NEWSLETTER_SAVE_CONCURRENCY,
	NewsletterMessageIdSchema,
	extractNewsletterLinks,
	findInboxToken,
	inboundRecipients,
	type FetchInboundEmail,
	type NewsletterInboxStore,
	type NewsletterMessageLink,
	type NewsletterMessageStore,
} from "@packages/domain/newsletter";
import type { SaveableUrl, ValidateSaveableUrl } from "@packages/domain/article";
import {
	saveArticleFromUrl,
	type SaveArticleFromUrlDependencies,
} from "../../shared/save-article/save-article-from-url";
import { verifyInboundSignature } from "./verify-inbound-signature";

interface NewsletterInboundRouteDeps extends SaveArticleFromUrlDependencies {
	validateSaveableUrl: ValidateSaveableUrl;
	newsletterInboxStore: NewsletterInboxStore;
	newsletterMessageStore: NewsletterMessageStore;
	fetchInboundEmail: FetchInboundEmail;
	inboxDomain: string;
	inboundSigningSecret: string;
	now: () => Date;
}

function header(req: Request, name: string): string | undefined {
	const value = req.headers[name];
	return typeof value === "string" ? value : undefined;
}

function parseJson(payload: string): unknown {
	try {
		return JSON.parse(payload);
	} catch {
		return undefined;
	}
}

export function initNewsletterInboundRoutes(deps: NewsletterInboundRouteDeps): Router {
	const router = express.Router();

	router.post(
		"/",
		express.text({ type: "application/json", limit: "1mb" }),
		async (req: Request, res: Response) => {
			const payload = typeof req.body === "string" ? req.body : "";

			const verification = verifyInboundSignature({
				secret: deps.inboundSigningSecret,
				payload,
				headers: {
					id: header(req, "svix-id"),
					timestamp: header(req, "svix-timestamp"),
					signature: header(req, "svix-signature"),
				},
				now: deps.now(),
			});
			if (!verification.ok) {
				res.status(401).json({ error: "invalid_signature" });
				return;
			}

			const parsed = InboundEmailWebhookSchema.safeParse(parseJson(payload));
			if (!parsed.success) {
				res.status(400).json({ error: "invalid_payload" });
				return;
			}
			const event = parsed.data;
			if (event.type !== INBOUND_EMAIL_RECEIVED_TYPE) {
				res.status(200).json({ status: "ignored" });
				return;
			}

			const token = findInboxToken({
				recipients: inboundRecipients(event.data.to),
				domain: deps.inboxDomain,
			});
			if (!token) {
				res.status(200).json({ status: "ignored" });
				return;
			}

			const userId = await deps.newsletterInboxStore.findUserIdByInboxToken(token);
			if (!userId) {
				res.status(200).json({ status: "ignored" });
				return;
			}

			const messageId = NewsletterMessageIdSchema.safeParse(event.data.email_id);
			if (!messageId.success) {
				res.status(200).json({ status: "ignored" });
				return;
			}

			const body = await deps.fetchInboundEmail(event.data.email_id);
			if (!body) {
				res.status(200).json({ status: "ignored" });
				return;
			}

			const { urls } = extractNewsletterLinks({ html: body.html });
			const saveable: SaveableUrl[] = [];
			let skippedCount = 0;
			for (const url of urls) {
				const validation = deps.validateSaveableUrl(url);
				if (validation.status === "SUCCESS") {
					saveable.push(validation.url);
				} else {
					skippedCount += 1;
				}
			}

			const savedLinks: NewsletterMessageLink[] = [];
			for (let i = 0; i < saveable.length; i += NEWSLETTER_SAVE_CONCURRENCY) {
				const batch = saveable.slice(i, i + NEWSLETTER_SAVE_CONCURRENCY);
				const results = await Promise.all(
					batch.map(async (url) => {
						const freshness = await deps.refreshArticleIfStale({ url });
						const { saved } = await saveArticleFromUrl(deps, { userId, url, freshness });
						return { url, articleId: saved.id };
					}),
				);
				savedLinks.push(...results);
			}

			await deps.newsletterMessageStore.recordMessage({
				id: messageId.data,
				userId,
				subject: event.data.subject ?? "",
				fromAddress: event.data.from,
				receivedAt: event.created_at,
				html: body.html,
				savedLinks,
				skippedCount,
			});

			res.status(200).json({
				status: "processed",
				saved: savedLinks.length,
				skipped: skippedCount,
			});
		},
	);

	return router;
}
