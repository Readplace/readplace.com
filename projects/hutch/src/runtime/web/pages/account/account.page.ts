import assert from "node:assert";
import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import { CheckoutSessionIdSchema } from "@packages/test-fixtures/providers/stripe-checkout";
import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { FindEmailByUserId } from "@packages/test-fixtures/providers/auth";
import type {
	CreateSetupCheckoutSession,
	RetrieveSetupCheckoutSession,
} from "@packages/test-fixtures/providers/stripe-checkout";
import type {
	FindSubscriptionByUserId,
	MarkSubscriptionActive,
	UpsertActiveSubscription,
	UpsertCustomerId,
	UpsertTrialingSubscription,
} from "@packages/test-fixtures/providers/subscription-providers";
import type {
	PublishAddPaymentMethodCommand,
	PublishCancelSubscriptionCommand,
	PublishSubscriptionReactivated,
} from "@packages/test-fixtures/providers/events";
import type {
	CreateStripeCustomer,
	ReverseScheduledCancellation,
} from "@packages/test-fixtures/providers/stripe-subscriptions";
import type {
	CreateTrialEndSchedule,
	DeleteDeferredCancellationSchedule,
} from "@packages/test-fixtures/providers/trial-scheduler";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { HxRedirectPage } from "../../hx-redirect-page";
import { sendComponent } from "../../send-component";
import type { GetEffectiveAccess } from "../../../domain/access/effective-access";
import { AccountPage } from "./account.component";
import { PaymentMethodSuccessPage } from "./payment-method-success.component";
import { parseAccountQuery, toAccountViewModel } from "./account.view-model";
import {
	ACCOUNT_ERROR_PAYMENT_METHOD_URL,
	ACCOUNT_PAYMENT_METHOD_FINALIZE_URL,
	buildAccountUrl,
} from "./account.url";

interface AccountDependencies {
	getEffectiveAccess: GetEffectiveAccess;
	findSubscriptionByUserId: FindSubscriptionByUserId;
	upsertActiveSubscription: UpsertActiveSubscription;
	upsertTrialingSubscription: UpsertTrialingSubscription;
	markActiveSubscription: MarkSubscriptionActive;
	upsertCustomerId: UpsertCustomerId;
	findEmailByUserId: FindEmailByUserId;
	publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand;
	publishSubscriptionReactivated: PublishSubscriptionReactivated;
	publishAddPaymentMethodCommand: PublishAddPaymentMethodCommand;
	createStripeCustomer: CreateStripeCustomer;
	reverseScheduledCancellation: ReverseScheduledCancellation;
	createTrialEndSchedule: CreateTrialEndSchedule;
	deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
	createSetupCheckoutSession: CreateSetupCheckoutSession;
	retrieveSetupCheckoutSession: RetrieveSetupCheckoutSession;
	buildPaymentMethodSuccessUrl: (sessionIdPlaceholder: string) => string;
	buildPaymentMethodCancelUrl: () => string;
	appOrigin: string;
	logger: HutchLogger;
	now: () => Date;
	buildBannerState: BuildBannerState;
}

const FinalizeBodySchema = z.object({
	session_id: z.string().min(1),
});

export function initAccountRoutes(deps: AccountDependencies): Router {
	const router = express.Router();

	router.get("/", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const access = await deps.getEffectiveAccess(req.userId);
		const row = await deps.findSubscriptionByUserId(req.userId);
		const vm = toAccountViewModel(access, parseAccountQuery(req.query), deps.now(), row);
		const bannerState = await deps.buildBannerState(req, { preFetchedAccess: access });
		sendComponent(req, res, Base(AccountPage(vm), bannerState));
	});

	router.post("/cancel", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		await deps.publishCancelSubscriptionCommand({ userId: req.userId });
		res.redirect(303, buildAccountUrl({ cancelling: true }));
	});

	router.post("/reactivate", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		try {
			const row = await deps.findSubscriptionByUserId(userId);
			if (!row || row.status !== "pending_cancellation") {
				res.redirect(303, buildAccountUrl());
				return;
			}

			await deps.deleteDeferredCancellationSchedule({ userId });

			if (row.subscriptionId) {
				await deps.reverseScheduledCancellation({ subscriptionId: row.subscriptionId });
				await deps.markActiveSubscription({ userId });
				await deps.publishSubscriptionReactivated({
					userId,
					subscriptionId: row.subscriptionId,
				});
				res.redirect(303, buildAccountUrl());
				return;
			}

			assert(
				row.trialEndsAt,
				"trial pending_cancellation row must have trialEndsAt",
			);
			await deps.createTrialEndSchedule({ userId, firesAt: row.trialEndsAt });
			await deps.upsertTrialingSubscription({ userId, trialEndsAt: row.trialEndsAt });
			await deps.publishSubscriptionReactivated({ userId });
			res.redirect(303, buildAccountUrl());
		} catch (err) {
			deps.logger.error("[reactivate] failed", {
				userId,
				error: err instanceof Error ? err.message : String(err),
			});
			res.redirect(303, ACCOUNT_ERROR_PAYMENT_METHOD_URL);
		}
	});

	/** HTMX intercepts hx-boost forms via XHR. A 303 Location to an external
	 * origin (Stripe Checkout) makes HTMX issue a cross-origin XHR and then
	 * fail to swap the response into <main>, so the browser never leaves
	 * /account. HxRedirectPage carries HTMX's HX-Redirect header, which
	 * triggers `window.location.href = url`. Plain (non-HTMX) form posts
	 * still get the 303 Location, so progressive enhancement is preserved. */
	function redirectExternal(req: Request, res: Response, url: string): void {
		if (req.get("HX-Request") === "true") {
			sendComponent(req, res, HxRedirectPage(url));
			return;
		}
		res.redirect(303, url);
	}

	async function ensureCustomerId(userId: UserId, email: string): Promise<string> {
		const existing = await deps.findSubscriptionByUserId(userId);
		if (existing?.customerId) return existing.customerId;
		const { customerId } = await deps.createStripeCustomer({ email, userId });
		const result = await deps.upsertCustomerId({ userId, customerId });
		if (result.ok) return customerId;
		/** Race: a concurrent POST won. Re-read for the winner's customerId.
		 * The loser's customerId stays orphan in Stripe — we never charge it
		 * because the row only points at the winner. */
		const fresh = await deps.findSubscriptionByUserId(userId);
		assert(fresh?.customerId, "conditional write conflict but no customerId on re-read");
		return fresh.customerId;
	}

	router.post("/payment-method", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		try {
			const userId = req.userId;
			const email = await deps.findEmailByUserId(userId);
			assert(email, "authenticated user must have an email address");
			const customerId = await ensureCustomerId(userId, email);
			const session = await deps.createSetupCheckoutSession({
				customerId,
				successUrl: deps.buildPaymentMethodSuccessUrl("{CHECKOUT_SESSION_ID}"),
				cancelUrl: `${deps.appOrigin}${deps.buildPaymentMethodCancelUrl()}`,
			});
			redirectExternal(req, res, session.url);
		} catch (err) {
			deps.logger.error("[payment-method] failed", {
				userId: req.userId,
				error: err instanceof Error ? err.message : String(err),
			});
			res.redirect(303, ACCOUNT_ERROR_PAYMENT_METHOD_URL);
		}
	});

	/** Stripe success_url is always a GET. Per the web skill: never mutate
	 * state on a GET. This handler renders a page with an auto-submitting
	 * POST form to /finalize, where the actual command publication happens.
	 * Idempotent on the Stripe session id — multiple GETs with the same id
	 * produce the same POST, and Stripe's idempotency on the eventual
	 * Customer PATCH makes re-publishes safe. */
	router.get("/payment-method/success", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : "";
		if (!sessionId) {
			res.redirect(303, buildAccountUrl());
			return;
		}
		const bannerState = await deps.buildBannerState(req);
		sendComponent(
			req,
			res,
			Base(
				PaymentMethodSuccessPage({
					sessionId,
					finalizeUrl: ACCOUNT_PAYMENT_METHOD_FINALIZE_URL,
				}),
				bannerState,
			),
		);
	});

	router.get("/payment-method/cancel", async (_req: Request, res: Response) => {
		res.redirect(303, buildAccountUrl());
	});

	router.post("/payment-method/finalize", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const parsed = FinalizeBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.redirect(303, buildAccountUrl());
			return;
		}
		try {
			const sessionId = CheckoutSessionIdSchema.parse(parsed.data.session_id);
			const session = await deps.retrieveSetupCheckoutSession(sessionId);
			if (!session.ok) {
				deps.logger.warn("[payment-method/finalize] session retrieve failed", {
					userId: req.userId,
					reason: session.reason,
				});
				res.redirect(303, ACCOUNT_ERROR_PAYMENT_METHOD_URL);
				return;
			}
			await deps.publishAddPaymentMethodCommand({
				userId: req.userId,
				customerId: session.customerId,
				paymentMethodId: session.paymentMethodId,
				brand: session.brand,
				last4: session.last4,
			});
			res.redirect(303, buildAccountUrl());
		} catch (err) {
			deps.logger.error("[payment-method/finalize] failed", {
				userId: req.userId,
				error: err instanceof Error ? err.message : String(err),
			});
			res.redirect(303, ACCOUNT_ERROR_PAYMENT_METHOD_URL);
		}
	});

	return router;
}
