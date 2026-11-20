import assert from "node:assert";
import { randomUUID } from "node:crypto";
import {
	newsletterLinkCountOf,
	type SavedLinksJobId,
	SavedLinksJobIdSchema,
} from "@packages/domain/article";
import { INBOX_PATH } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { RunSavedLinksJobDetail } from "@packages/infra-components";
import type {
	FindSavedLinksJob,
	RequestSavedLinksJob,
	WithdrawSavedLinksJob,
} from "@packages/provider-contracts/article-store";
import { sendComponent } from "@packages/web-shell";
import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type { BuildBannerState } from "../../banner-state";
import { Base } from "../../base.component";
import { NEWSLETTER_LINKS_REMOVE_PATH } from "./newsletter-links.url";
import { NewsletterLinksConfirmPage } from "./newsletter-links-confirm.component";

export interface NewsletterLinksDependencies {
	findSavedLinksJob: FindSavedLinksJob;
	requestSavedLinksJob: RequestSavedLinksJob;
	withdrawSavedLinksJob: WithdrawSavedLinksJob;
	publishRunSavedLinksJob: (detail: RunSavedLinksJobDetail) => Promise<void>;
	buildBannerState: BuildBannerState;
	requireNotLocked: RequestHandler;
	requirePaidFeatures: RequestHandler;
	now: () => Date;
}

const RemoveBodySchema = z.object({
	count: SavedLinksJobIdSchema,
	senders: z.enum(["all", "chosen"]),
	sender: z
		.union([z.string(), z.array(z.string())])
		.optional()
		.transform((value) => (value === undefined ? [] : [value].flat())),
});

export function initNewsletterLinksRoutes(
	deps: NewsletterLinksDependencies,
): Router {
	const router = express.Router();

	async function claimAndPublish(params: {
		userId: UserId;
		job: RunSavedLinksJobDetail["job"];
	}): Promise<"claimed" | "busy"> {
		const requestedAt = deps.now();
		const jobId: SavedLinksJobId = SavedLinksJobIdSchema.parse(
			`${requestedAt.toISOString()}-${randomUUID()}`,
		);
		const claim = await deps.requestSavedLinksJob({
			userId: params.userId,
			jobId,
			action: params.job.action,
			requestedAt,
		});
		if (claim.outcome === "busy") return "busy";
		try {
			await deps.publishRunSavedLinksJob({
				userId: params.userId,
				jobId,
				requestedAt: requestedAt.toISOString(),
				job: params.job,
			});
		} catch (error) {
			await deps.withdrawSavedLinksJob({ userId: params.userId, jobId });
			throw error;
		}
		return "claimed";
	}

	router.post("/count", async (req: Request, res: Response) => {
		assert(
			req.userId,
			"userId required - route must be protected by requireAuth",
		);
		const outcome = await claimAndPublish({
			userId: req.userId,
			job: { action: "count" },
		});
		res.redirect(
			303,
			outcome === "busy" ? INBOX_PATH : NEWSLETTER_LINKS_REMOVE_PATH,
		);
	});

	router.get("/remove", async (req: Request, res: Response) => {
		assert(
			req.userId,
			"userId required - route must be protected by requireAuth",
		);
		const state = newsletterLinkCountOf(
			await deps.findSavedLinksJob({ userId: req.userId }),
		);
		if (state.kind === "busy") {
			if (req.get("HX-Request") === "true") {
				res.set("HX-Redirect", INBOX_PATH).status(204).send();
				return;
			}
			res.redirect(303, INBOX_PATH);
			return;
		}
		const bannerState = await deps.buildBannerState(req);
		sendComponent(
			req,
			res,
			Base(NewsletterLinksConfirmPage(state), bannerState),
		);
	});

	router.post(
		"/remove",
		deps.requireNotLocked,
		deps.requirePaidFeatures,
		async (req: Request, res: Response) => {
			assert(
				req.userId,
				"userId required - route must be protected by requireAuth",
			);
			const userId = req.userId;
			const body = RemoveBodySchema.safeParse(req.body);
			const state = newsletterLinkCountOf(
				await deps.findSavedLinksJob({ userId }),
			);
			if (
				!body.success ||
				state.kind !== "counted" ||
				state.jobId !== body.data.count
			) {
				res.redirect(303, NEWSLETTER_LINKS_REMOVE_PATH);
				return;
			}
			const counted = new Set(
				state.counted.summary.bySender.map((sender) => sender.senderEmail),
			);
			const chosen = body.data.sender;
			const chosenListed =
				chosen.length > 0 &&
				chosen.every((senderEmail) => counted.has(senderEmail));
			const choiceMatchesTicks =
				body.data.senders === "chosen" ? chosenListed : chosen.length === 0;
			if (!choiceMatchesTicks) {
				res.redirect(303, NEWSLETTER_LINKS_REMOVE_PATH);
				return;
			}
			await claimAndPublish({
				userId,
				job: {
					action: "remove",
					cutoff: state.counted.cutoff.toISOString(),
					senders:
						body.data.senders === "all"
							? { kind: "all" }
							: { kind: "chosen", senderEmails: chosen },
				},
			});
			res.redirect(303, INBOX_PATH);
		},
	);

	return router;
}
