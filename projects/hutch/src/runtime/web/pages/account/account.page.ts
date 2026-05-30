import assert from "node:assert";
import type { Request, Response, Router } from "express";
import express from "express";
import type { HutchLogger } from "@packages/hutch-logger";
import type { FindEmailByUserId } from "@packages/test-fixtures/providers/auth";
import type {
	CreateCheckoutSession,
	CheckoutSessionId,
} from "@packages/test-fixtures/providers/stripe-checkout";
import type {
	FindSubscriptionByUserId,
	MarkSubscriptionActive,
	UpsertActiveSubscription,
	UpsertTrialingSubscription,
} from "@packages/test-fixtures/providers/subscription-providers";
import type {
	PublishCancelSubscriptionCommand,
	PublishSubscriptionReactivated,
} from "@packages/test-fixtures/providers/events";
import type {
	CreateSubscriptionOnExistingCustomer,
	ReverseScheduledCancellation,
} from "@packages/test-fixtures/providers/stripe-subscriptions";
import type {
	CreateTrialEndSchedule,
	DeleteDeferredCancellationSchedule,
} from "@packages/test-fixtures/providers/trial-scheduler";
import type { StorePendingSignup } from "@packages/test-fixtures/providers/pending-signup";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { HxRedirectPage } from "../../hx-redirect-page";
import { sendComponent } from "../../send-component";
import type { GetEffectiveAccess } from "../../../domain/access/effective-access";
import { AccountPage } from "./account.component";
import { parseAccountQuery, toAccountViewModel } from "./account.view-model";
import { ACCOUNT_ERROR_PAYMENT_METHOD_URL, buildAccountUrl } from "./account.url";

interface AccountDependencies {
	getEffectiveAccess: GetEffectiveAccess;
	findSubscriptionByUserId: FindSubscriptionByUserId;
	upsertActiveSubscription: UpsertActiveSubscription;
	upsertTrialingSubscription: UpsertTrialingSubscription;
	markActiveSubscription: MarkSubscriptionActive;
	findEmailByUserId: FindEmailByUserId;
	publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand;
	publishSubscriptionReactivated: PublishSubscriptionReactivated;
	createCheckoutSession: CreateCheckoutSession;
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
	reverseScheduledCancellation: ReverseScheduledCancellation;
	createTrialEndSchedule: CreateTrialEndSchedule;
	deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
	storePendingSignup: StorePendingSignup;
	stripePriceId: string;
	buildCheckoutSuccessUrl: (sessionIdPlaceholder: string) => string;
	appOrigin: string;
	logger: HutchLogger;
	now: () => Date;
	buildBannerState: BuildBannerState;
}

type SubscribeBranchKey = "trialing" | "cancelled" | "noop" | "forbidden";

export function initAccountRoutes(deps: AccountDependencies): Router {
	const router = express.Router();

	router.get("/", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const access = await deps.getEffectiveAccess(req.userId);
		const vm = toAccountViewModel(access, parseAccountQuery(req.query), deps.now());
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
				// Defensive noop: covers double-click + race with the deferred
				// scheduler. The user lands back on /account and sees whatever
				// state they're actually in.
				res.redirect(303, buildAccountUrl());
				return;
			}

			// Delete the deferred-cancellation schedule first. Without this, the
			// schedule fires later, dispatches CancelSubscriptionCommand against
			// the now-active/trialing row, and re-cancels the user.
			await deps.deleteDeferredCancellationSchedule({ userId });

			if (row.subscriptionId) {
				// Paid path — Stripe still owns the subscription; tell it to stop
				// the scheduled cancel, then flip the row back to active.
				await deps.reverseScheduledCancellation({ subscriptionId: row.subscriptionId });
				await deps.markActiveSubscription({ userId });
				await deps.publishSubscriptionReactivated({
					userId,
					subscriptionId: row.subscriptionId,
				});
				res.redirect(303, buildAccountUrl());
				return;
			}

			// Trial path — no Stripe subscription exists. Recreate the trial-end
			// auto-charge schedule first; if that fails the row stays
			// pending_cancellation and the user can retry. Order matters: a
			// dangling trial-end schedule is harmless (fires
			// SubscriptionStartRequestCommand against a still-pending_cancellation
			// row, which the start-request handler noops because status !==
			// "trialing"), but a row update with no schedule means free-forever.
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

	async function startCheckout(
		req: Request,
	): Promise<{ id: CheckoutSessionId; url: string }> {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const email = await deps.findEmailByUserId(userId);
		assert(email, "authenticated user must have an email address");

		const checkout = await deps.createCheckoutSession({
			customerEmail: email,
			successUrl: deps.buildCheckoutSuccessUrl("{CHECKOUT_SESSION_ID}"),
			cancelUrl: `${deps.appOrigin}${buildAccountUrl()}`,
		});

		await deps.storePendingSignup({
			checkoutSessionId: checkout.id,
			signup: {
				method: "existing-user-subscribe",
				email,
				userId,
				returnUrl: "/queue",
			},
			createdAt: deps.now().getTime(),
		});

		return checkout;
	}

	/** HTMX intercepts hx-boost forms via XHR. A 303 Location to an external
	 * origin (Stripe Checkout) makes HTMX issue a cross-origin XHR and then
	 * fail to swap the response into <main>, so the browser never leaves
	 * /account. HxRedirectPage carries HTMX's HX-Redirect header, which
	 * triggers `window.location.href = url`. Plain (non-HTMX) form posts
	 * still get the 303 Location, so progressive enhancement is preserved. */
	function redirectToCheckout(req: Request, res: Response, url: string): void {
		if (req.get("HX-Request") === "true") {
			sendComponent(req, res, HxRedirectPage(url));
			return;
		}
		res.redirect(303, url);
	}

	const subscribeBranches: Record<
		SubscribeBranchKey,
		(req: Request, res: Response) => Promise<void>
	> = {
		trialing: async (req, res) => {
			const checkout = await startCheckout(req);
			redirectToCheckout(req, res, checkout.url);
		},
		cancelled: async (req, res) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const row = await deps.findSubscriptionByUserId(userId);
			assert(row, "cancelled branch requires a row");
			if (!row.customerId) {
				deps.logger.warn(
					"[subscribe] cancelled row without customerId — falling back to checkout",
					{ userId },
				);
				const checkout = await startCheckout(req);
				redirectToCheckout(req, res, checkout.url);
				return;
			}
			try {
				const { subscriptionId } = await deps.createSubscriptionOnExistingCustomer({
					customerId: row.customerId,
					priceId: deps.stripePriceId,
				});
				await deps.upsertActiveSubscription({
					userId,
					subscriptionId,
					customerId: row.customerId,
				});
				res.redirect(303, buildAccountUrl());
			} catch (err) {
				/** Stripe rejected the saved card (declined, expired, fingerprint
				 * mismatch, etc.). Rather than parking the user on a dead-end
				 * error page, fall through to Stripe Checkout so they can enter
				 * a new card. The fresh Checkout flow creates a brand-new
				 * subscription on success; the previously cancelled subscription
				 * stays orphan in Stripe and the user's row gets the new
				 * subscriptionId — same shape as a first-time subscription. */
				deps.logger.warn(
					"[subscribe/cancelled] one-click resub failed — falling back to checkout",
					{ userId, error: err instanceof Error ? err.message : String(err) },
				);
				const checkout = await startCheckout(req);
				redirectToCheckout(req, res, checkout.url);
			}
		},
		noop: async (_req, res) => {
			res.redirect(303, buildAccountUrl());
		},
		forbidden: async (_req, res) => {
			res.status(400).send("No subscription record to subscribe from");
		},
	};

	router.post("/subscribe", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const row = await deps.findSubscriptionByUserId(req.userId);
		const branch = pickSubscribeBranch(row?.status);
		try {
			await subscribeBranches[branch](req, res);
		} catch (err) {
			/** Single route-level catch keeps every branch resilient: Stripe
			 * (checkout create, subscriptions.create), DynamoDB (pending-signup
			 * write, upsertActive) or any other downstream failure redirects to
			 * the payment-method error page instead of crashing the Lambda. */
			deps.logger.error(`[subscribe/${branch}] failed`, {
				userId: req.userId,
				error: err instanceof Error ? err.message : String(err),
			});
			res.redirect(303, ACCOUNT_ERROR_PAYMENT_METHOD_URL);
		}
	});

	return router;
}

function pickSubscribeBranch(status: string | undefined): SubscribeBranchKey {
	switch (status) {
		case "trialing":
			return "trialing";
		case "cancelled":
			return "cancelled";
		case "active":
			return "noop";
		// Sending pending_cancellation users through the "cancelled"
		// resubscribe path would create a NEW Stripe subscription while the
		// existing one is still scheduled to cancel, double-billing the user.
		// Reactivation lives on /account/reactivate; treat /subscribe as a
		// noop here so the form click only re-renders /account.
		case "pending_cancellation":
			return "noop";
		default:
			return "forbidden";
	}
}
