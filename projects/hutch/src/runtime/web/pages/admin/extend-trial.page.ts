import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { sendComponent } from "@packages/web-shell";
import type { FindUserByEmail } from "@packages/provider-contracts/auth";
import type {
	FindSubscriptionByUserId,
	UpsertTrialingSubscription,
} from "@packages/provider-contracts/subscription-providers";
import { resolveTrialExtension } from "../../../domain/trial/resolve-trial-extension";
import {
	type TrialSchedulerPort,
	startTrial,
	trialEndsAtFromNow,
} from "../../../domain/trial/start-trial";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { flattenZodErrors } from "../../auth/flatten-zod-errors";
import type { ComponentError } from "../../shared/component-error.types";
import { AdminExtendTrialPage } from "./extend-trial.component";
import { ExtendTrialSchema } from "./extend-trial.schema";
import {
	type ExtendTrialLookup,
	REFUSAL_MESSAGE,
	toDateTimeLocalInput,
	toExtendTrialViewModel,
} from "./extend-trial.view-model";
import { initRequireAdmin } from "./require-admin.middleware";

export interface AdminExtendTrialDependencies {
	findUserByEmail: FindUserByEmail;
	findSubscriptionByUserId: FindSubscriptionByUserId;
	upsertTrialing: UpsertTrialingSubscription;
	trialScheduler: TrialSchedulerPort;
	adminEmails: readonly string[];
	serviceToken: string;
	logError: (message: string, error?: Error) => void;
	now: () => Date;
	buildBannerState: BuildBannerState;
}

function noStore(_req: Request, res: Response, next: NextFunction): void {
	res.setHeader("Cache-Control", "no-store");
	next();
}

export function initAdminExtendTrialRoutes(deps: AdminExtendTrialDependencies): Router {
	const router = express.Router();

	router.use(noStore);
	router.use(
		initRequireAdmin({
			findUserByEmail: deps.findUserByEmail,
			adminEmails: deps.adminEmails,
			serviceToken: deps.serviceToken,
		}),
	);

	async function respond(
		req: Request,
		res: Response,
		input: {
			lookup: ExtendTrialLookup;
			errors?: ComponentError[];
			extended?: boolean;
			statusCode?: number;
		},
	): Promise<void> {
		const viewModel = toExtendTrialViewModel(input);
		sendComponent(
			req,
			res,
			Base(
				AdminExtendTrialPage(viewModel, { statusCode: input.statusCode }),
				await deps.buildBannerState(req),
			),
		);
	}

	/** Resolve what the operator should see for an email: the user may not exist,
	 * the policy may refuse them, or they are extendable and we prefill the date
	 * input with whatever window they currently have. */
	async function lookup(email: string): Promise<ExtendTrialLookup> {
		const user = await deps.findUserByEmail(email);
		if (!user) return { kind: "not-found", email };

		const subscription = await deps.findSubscriptionByUserId(user.userId);
		const now = deps.now();
		// Probe the policy with a known-good future date so a refusal here can only
		// mean founding-member or paid-subscription, never not-in-future.
		const decision = resolveTrialExtension({
			subscription,
			trialEndsAt: trialEndsAtFromNow(now),
			now,
		});

		if (!decision.allowed) {
			return {
				kind: "refused",
				email,
				status: subscription?.status,
				message: REFUSAL_MESSAGE[decision.refusal.reason],
			};
		}

		return {
			kind: "ready",
			email,
			status: decision.previousStatus,
			currentTrialEndsAt: decision.previousTrialEndsAt,
			trialEndsAtInput: toDateTimeLocalInput(
				decision.previousTrialEndsAt ?? trialEndsAtFromNow(now),
			),
		};
	}

	router.get("/", async (req: Request, res: Response) => {
		const email = typeof req.query.email === "string" ? req.query.email.trim() : "";
		if (email === "") {
			await respond(req, res, { lookup: { kind: "none" } });
			return;
		}
		await respond(req, res, {
			lookup: await lookup(email),
			extended: req.query.extended === "1",
		});
	});

	router.post("/", async (req: Request, res: Response) => {
		const parsed = ExtendTrialSchema.safeParse(req.body);
		if (!parsed.success) {
			const email = typeof req.body?.email === "string" ? req.body.email : "";
			await respond(req, res, {
				lookup: email === "" ? { kind: "none" } : await lookup(email),
				errors: flattenZodErrors(parsed.error.issues),
				statusCode: 422,
			});
			return;
		}

		const { email, trialEndsAt } = parsed.data;
		const user = await deps.findUserByEmail(email);
		if (!user) {
			await respond(req, res, {
				lookup: { kind: "not-found", email },
				statusCode: 422,
			});
			return;
		}

		// Re-decided server-side: the round-trip through the form is not trusted.
		const subscription = await deps.findSubscriptionByUserId(user.userId);
		const decision = resolveTrialExtension({ subscription, trialEndsAt, now: deps.now() });
		if (!decision.allowed) {
			await respond(req, res, {
				lookup: {
					kind: "refused",
					email,
					status: subscription?.status,
					message: REFUSAL_MESSAGE[decision.refusal.reason],
				},
				statusCode: 422,
			});
			return;
		}

		try {
			await startTrial({
				mode: "reset",
				userId: user.userId,
				trialEndsAt: decision.trialEndsAt,
				now: deps.now(),
				upsertTrialing: deps.upsertTrialing,
				trialScheduler: deps.trialScheduler,
			});
		} catch (err) {
			deps.logError(
				"[admin/extend-trial] failed",
				err instanceof Error ? err : new Error(String(err)),
			);
			await respond(req, res, {
				lookup: await lookup(email),
				errors: [
					{ message: "Could not arm the trial schedules — nothing was changed. Try again." },
				],
				statusCode: 422,
			});
			return;
		}

		// POST-Redirect-GET onto a live re-read, so the success page shows what was
		// actually committed rather than what we believe we committed.
		res.redirect(303, `/admin/extend-trial?email=${encodeURIComponent(email)}&extended=1`);
	});

	return router;
}
