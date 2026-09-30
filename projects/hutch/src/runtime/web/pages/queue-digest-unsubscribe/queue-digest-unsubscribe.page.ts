import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type { UserId } from "@packages/domain/user";
import type { SetQueueDigestOptOut } from "@packages/provider-contracts/auth";
import {
	ANALYTICS_EVENTS,
	QUEUE_DIGEST_UNSUBSCRIBE_METHODS,
	type QueueDigestUnsubscribedEvent,
	type RecordUngatedEvent,
	STREAMS,
} from "@packages/web-analytics";
import { sendComponent } from "@packages/web-shell";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { noindexMiddleware } from "../../middleware/noindex.middleware";
import { QUEUE_DIGEST_UNSUBSCRIBE_PATH } from "../../queue-digest-email";
import { QueueDigestUnsubscribePage } from "./queue-digest-unsubscribe.component";

interface QueueDigestUnsubscribeDependencies {
	verifyUnsubscribeToken: (token: string) => UserId | undefined;
	setQueueDigestOptOut: SetQueueDigestOptOut;
	recordUngatedAnalyticsEvent: RecordUngatedEvent<QueueDigestUnsubscribedEvent>;
	now: () => Date;
	buildBannerState: BuildBannerState;
}

const UnsubscribeQuerySchema = z.object({ t: z.string() });

const ConfirmedFromPageSchema = z.object({ confirm: z.literal("page") });

export function initQueueDigestUnsubscribeRoutes(deps: QueueDigestUnsubscribeDependencies): Router {
	const router = express.Router();

	function unsubscriberOf(req: Request): { token: string; userId: UserId } | undefined {
		const query = UnsubscribeQuerySchema.safeParse(req.query);
		if (!query.success) return undefined;
		const userId = deps.verifyUnsubscribeToken(query.data.t);
		if (userId === undefined) return undefined;
		return { token: query.data.t, userId };
	}

	router.get(QUEUE_DIGEST_UNSUBSCRIBE_PATH, noindexMiddleware, async (req: Request, res: Response) => {
		const unsubscriber = unsubscriberOf(req);
		if (!unsubscriber) {
			sendComponent(req, res, Base(QueueDigestUnsubscribePage({ kind: "invalid" }), await deps.buildBannerState(req)));
			return;
		}
		sendComponent(
			req,
			res,
			Base(
				QueueDigestUnsubscribePage(
					req.query.done === "1" ? { kind: "done" } : { kind: "confirm", token: unsubscriber.token },
				),
				await deps.buildBannerState(req),
			),
		);
	});

	router.post(QUEUE_DIGEST_UNSUBSCRIBE_PATH, noindexMiddleware, async (req: Request, res: Response) => {
		const unsubscriber = unsubscriberOf(req);
		if (!unsubscriber) {
			sendComponent(req, res, Base(QueueDigestUnsubscribePage({ kind: "invalid" }), await deps.buildBannerState(req)));
			return;
		}
		const now = deps.now();
		await deps.setQueueDigestOptOut({ userId: unsubscriber.userId, optedOutAt: now.toISOString() });
		const confirmedFromPage = ConfirmedFromPageSchema.safeParse(req.body).success;
		deps.recordUngatedAnalyticsEvent({
			stream: STREAMS.analytics,
			event: ANALYTICS_EVENTS.queueDigestUnsubscribed,
			timestamp: now.toISOString(),
			user_id: unsubscriber.userId,
			method: confirmedFromPage
				? QUEUE_DIGEST_UNSUBSCRIBE_METHODS.page
				: QUEUE_DIGEST_UNSUBSCRIBE_METHODS.oneClick,
		});
		if (confirmedFromPage) {
			const done = new URLSearchParams({ t: unsubscriber.token, done: "1" });
			res.redirect(303, `${QUEUE_DIGEST_UNSUBSCRIBE_PATH}?${done.toString()}`);
			return;
		}
		res.status(200).end();
	});

	return router;
}
