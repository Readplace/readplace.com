import type { Request, Response, Router } from "express";
import express from "express";
import { sendComponent } from "@packages/web-shell";
import type { FindUserByEmail } from "@packages/provider-contracts/auth";
import type {
	FindSubscriptionByUserId,
	RecordFounderNote,
} from "@packages/provider-contracts/subscription-providers";
import { trialDayOf } from "../../../domain/trial/trial-day";
import type { EmitLifecycleEmailSent } from "../../../observability/lifecycle-email-events";
import { flattenZodErrors } from "../../auth/flatten-zod-errors";
import type { BuildBannerState } from "../../banner-state";
import { Base } from "../../base.component";
import { AdminFounderNotesPage, type FounderNotesViewModel } from "./founder-notes.component";
import { FormFieldsSchema, founderNoteSchema } from "./founder-notes.schema";

export interface AdminFounderNotesDependencies {
	findUserByEmail: FindUserByEmail;
	findSubscriptionByUserId: FindSubscriptionByUserId;
	recordFounderNote: RecordFounderNote;
	emitLifecycleEmailSent: EmitLifecycleEmailSent;
	now: () => Date;
	buildBannerState: BuildBannerState;
}

const LIFECYCLE_KIND_OF_NOTE = {
	"day-1": "founder-note-day1",
	"day-12": "founder-note-day12",
} as const;

const LAST_MS_OF_UTC_DAY = 24 * 60 * 60 * 1000 - 1;

export function initAdminFounderNotesRoutes(deps: AdminFounderNotesDependencies): Router {
	const router = express.Router();

	async function respond(
		req: Request,
		res: Response,
		input: { viewModel: FounderNotesViewModel; statusCode: number },
	): Promise<void> {
		sendComponent(
			req,
			res,
			Base(
				AdminFounderNotesPage(input.viewModel, { statusCode: input.statusCode }),
				await deps.buildBannerState(req),
			),
		);
	}

	router.get("/", async (req: Request, res: Response) => {
		const form = FormFieldsSchema.parse(req.query);
		const recorded = form.email !== "" && req.query.recorded === "1";
		await respond(req, res, {
			viewModel: {
				form,
				errors: [],
				alerts: recorded ? [{ variant: "success", text: `Recorded for ${form.email}.` }] : [],
			},
			statusCode: 200,
		});
	});

	router.post("/", async (req: Request, res: Response) => {
		const form = FormFieldsSchema.parse(req.body);
		const parsed = founderNoteSchema(deps.now()).safeParse(form);
		if (!parsed.success) {
			await respond(req, res, {
				viewModel: { form, errors: flattenZodErrors(parsed.error.issues), alerts: [] },
				statusCode: 422,
			});
			return;
		}

		const { email, note, sentAt } = parsed.data;
		const user = await deps.findUserByEmail(email);
		if (!user) {
			await respond(req, res, {
				viewModel: {
					form,
					errors: [],
					alerts: [{ variant: "error", text: "No account with that email." }],
				},
				statusCode: 422,
			});
			return;
		}

		const subscription = await deps.findSubscriptionByUserId(user.userId);
		if (!subscription) {
			await respond(req, res, {
				viewModel: {
					form,
					errors: [],
					alerts: [{ variant: "error", text: `No subscription row for ${email}.` }],
				},
				statusCode: 422,
			});
			return;
		}

		await deps.recordFounderNote({ userId: user.userId, sentAt });
		deps.emitLifecycleEmailSent({
			userId: user.userId,
			kind: LIFECYCLE_KIND_OF_NOTE[note],
			trialDay:
				subscription.trialEndsAt === undefined
					? null
					: trialDayOf({
							trialEndsAt: subscription.trialEndsAt,
							at: new Date(Date.parse(sentAt) + LAST_MS_OF_UTC_DAY),
						}),
			utmSource: "founder-note",
			delivery: "founder-manual",
		});

		res.redirect(303, `/admin/founder-notes?email=${encodeURIComponent(email)}&recorded=1`);
	});

	return router;
}
