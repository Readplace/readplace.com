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
import type { GetEffectiveAccess } from "../../../domain/access/effective-access";
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
	getEffectiveAccess: GetEffectiveAccess;
	logError: (message: string, error?: Error) => void;
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

			/** Read-only users (trial-expired / cancelled) may read newsletters but
			 * not grow their reading queue — the same invariant `requireWriteAccess`
			 * enforces on /import and the /queue save routes. The message is still
			 * recorded so the inbox stays usable; only the link-save is gated. */
			const canSave = (await deps.getEffectiveAccess(userId)).access === "full";

			const savedLinks: NewsletterMessageLink[] = [];
			let skippedCount = 0;
			if (canSave) {
				const { urls } = extractNewsletterLinks({ html: body.html });
				const saveable: SaveableUrl[] = [];
				for (const url of urls) {
					const validation = deps.validateSaveableUrl(url);
					if (validation.status === "SUCCESS") {
						saveable.push(validation.url);
					} else {
						skippedCount += 1;
					}
				}
				for (let i = 0; i < saveable.length; i += NEWSLETTER_SAVE_CONCURRENCY) {
					const batch = saveable.slice(i, i + NEWSLETTER_SAVE_CONCURRENCY);
					/** Isolate each save the way file import does. A single link that
					 * throws (DynamoDB throttle, SQS/EventBridge hiccup) must not reject
					 * the whole batch: that would leave the message unrecorded and make
					 * Resend retry the event, re-saving the links that already succeeded.
					 * Failures are logged and counted as skipped so the handler always
					 * records the message and returns 200. */
					const results = await Promise.all(
						batch.map((url) =>
							deps
								.refreshArticleIfStale({ url })
								.then((freshness) => saveArticleFromUrl(deps, { userId, url, freshness }))
								.then(({ saved }): NewsletterMessageLink | undefined => ({
									url,
									articleId: saved.id,
								}))
								.catch((error: unknown): NewsletterMessageLink | undefined => {
									deps.logError(
										`Failed to save newsletter link url=${url}`,
										error instanceof Error ? error : undefined,
									);
									return undefined;
								}),
						),
					);
					for (const link of results) {
						if (link) {
							savedLinks.push(link);
						} else {
							skippedCount += 1;
						}
					}
				}
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
				status: canSave ? "processed" : "read-only",
				saved: savedLinks.length,
				skipped: skippedCount,
			});
		},
	);

	return router;
}
