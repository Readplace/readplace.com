import assert from "node:assert";
import { randomUUID } from "node:crypto";
import {
	type NewsletterLinkCount,
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
import { type PageBody, sendComponent } from "@packages/web-shell";
import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type { BuildBannerState } from "../../banner-state";
import { Base } from "../../base.component";
import {
	NEWSLETTER_LINKS_REMOVE_PATH,
	NEWSLETTER_LINKS_RESTORE_PATH,
} from "./newsletter-links.url";
import {
	type NewsletterLinksConfirmState,
	NewsletterLinksConfirmPage,
} from "./newsletter-links-confirm.component";
import { NewsletterLinksRestorePage } from "./newsletter-links-restore.component";

type RunSavedLinksJobSenders = Extract<
	RunSavedLinksJobDetail["job"],
	{ action: "restore" }
>["senders"];

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

const CountBodySchema = z.object({
	next: z.enum(["restore"]).optional(),
});

const ChooseSendersBodySchema = z.object({
	count: SavedLinksJobIdSchema,
	senders: z.enum(["all", "chosen"]),
	sender: z
		.union([z.string(), z.array(z.string())])
		.optional()
		.transform((value) => (value === undefined ? [] : [value].flat())),
});

type CountedState = Extract<NewsletterLinkCount, { kind: "counted" }>;

function chosenSendersOf(params: {
	body: unknown;
	state: NewsletterLinkCount;
	listed: (state: CountedState) => Array<{ senderEmail: string }>;
}): { cutoff: Date; senders: RunSavedLinksJobSenders } | undefined {
	const body = ChooseSendersBodySchema.safeParse(params.body);
	const { state } = params;
	if (
		!body.success ||
		state.kind !== "counted" ||
		state.jobId !== body.data.count
	) {
		return undefined;
	}
	const counted = new Set(
		params.listed(state).map((sender) => sender.senderEmail),
	);
	const chosen = body.data.sender;
	const chosenListed =
		chosen.length > 0 &&
		chosen.every((senderEmail) => counted.has(senderEmail));
	const choiceMatchesTicks =
		body.data.senders === "chosen" ? chosenListed : chosen.length === 0;
	if (!choiceMatchesTicks) return undefined;
	return {
		cutoff: state.counted.cutoff,
		senders:
			body.data.senders === "all"
				? { kind: "all" }
				: { kind: "chosen", senderEmails: chosen },
	};
}

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
		const body = CountBodySchema.safeParse(req.body);
		const outcome = await claimAndPublish({
			userId: req.userId,
			job: { action: "count" },
		});
		if (outcome === "busy") {
			res.redirect(303, INBOX_PATH);
			return;
		}
		res.redirect(
			303,
			body.success && body.data.next === "restore"
				? NEWSLETTER_LINKS_RESTORE_PATH
				: NEWSLETTER_LINKS_REMOVE_PATH,
		);
	});

	function countPage(
		page: (state: NewsletterLinksConfirmState) => PageBody,
	): RequestHandler {
		return async (req: Request, res: Response) => {
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
			sendComponent(req, res, Base(page(state), bannerState));
		};
	}

	router.get("/remove", countPage(NewsletterLinksConfirmPage));
	router.get("/restore", countPage(NewsletterLinksRestorePage));

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
			const choice = chosenSendersOf({
				body: req.body,
				state: newsletterLinkCountOf(await deps.findSavedLinksJob({ userId })),
				listed: (state) => state.counted.summary.bySender,
			});
			if (choice === undefined) {
				res.redirect(303, NEWSLETTER_LINKS_REMOVE_PATH);
				return;
			}
			await claimAndPublish({
				userId,
				job: {
					action: "remove",
					cutoff: choice.cutoff.toISOString(),
					senders: choice.senders,
				},
			});
			res.redirect(303, INBOX_PATH);
		},
	);

	router.post(
		"/restore",
		deps.requireNotLocked,
		deps.requirePaidFeatures,
		async (req: Request, res: Response) => {
			assert(
				req.userId,
				"userId required - route must be protected by requireAuth",
			);
			const userId = req.userId;
			const choice = chosenSendersOf({
				body: req.body,
				state: newsletterLinkCountOf(await deps.findSavedLinksJob({ userId })),
				listed: (state) => state.counted.held.bySender,
			});
			if (choice === undefined) {
				res.redirect(303, NEWSLETTER_LINKS_RESTORE_PATH);
				return;
			}
			await claimAndPublish({
				userId,
				job: { action: "restore", senders: choice.senders },
			});
			res.redirect(303, INBOX_PATH);
		},
	);

	return router;
}
