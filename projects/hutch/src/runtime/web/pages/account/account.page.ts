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
	UpsertActiveSubscription,
} from "@packages/test-fixtures/providers/subscription-providers";
import type { PublishCancelSubscriptionCommand } from "@packages/test-fixtures/providers/events";
import type { CreateSubscriptionOnExistingCustomer } from "@packages/test-fixtures/providers/stripe-subscriptions";
import type { StorePendingSignup } from "@packages/test-fixtures/providers/pending-signup";
import { Base } from "../../base.component";
import { bannerStateFromRequest } from "../../banner-state";
import { sendComponent } from "../../send-component";
import type { GetEffectiveAccess } from "../../../domain/access/effective-access";
import { AccountPage } from "./account.component";
import { parseAccountQuery, toAccountViewModel } from "./account.view-model";
import { ACCOUNT_ERROR_PAYMENT_METHOD_URL, buildAccountUrl } from "./account.url";

interface AccountDependencies {
	getEffectiveAccess: GetEffectiveAccess;
	findSubscriptionByUserId: FindSubscriptionByUserId;
	upsertActiveSubscription: UpsertActiveSubscription;
	findEmailByUserId: FindEmailByUserId;
	publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand;
	createCheckoutSession: CreateCheckoutSession;
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
	storePendingSignup: StorePendingSignup;
	stripePriceId: string;
	buildCheckoutSuccessUrl: (sessionIdPlaceholder: string) => string;
	appOrigin: string;
	logger: HutchLogger;
	now: () => Date;
}

type SubscribeBranchKey = "trialing" | "cancelled" | "noop" | "forbidden";

export function initAccountRoutes(deps: AccountDependencies): Router {
	const router = express.Router();

	router.get("/", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const access = await deps.getEffectiveAccess(req.userId);
		const vm = toAccountViewModel(access, parseAccountQuery(req.query), deps.now());
		sendComponent(req, res, Base(AccountPage(vm), bannerStateFromRequest(req)));
	});

	router.post("/cancel", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		await deps.publishCancelSubscriptionCommand({ userId: req.userId });
		res.redirect(303, buildAccountUrl({ cancelling: true }));
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

	const subscribeBranches: Record<
		SubscribeBranchKey,
		(req: Request, res: Response) => Promise<void>
	> = {
		trialing: async (req, res) => {
			const checkout = await startCheckout(req);
			res.redirect(303, checkout.url);
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
				res.redirect(303, checkout.url);
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
				deps.logger.error(
					"[subscribe/cancelled] createSubscriptionOnExistingCustomer failed",
					{ userId, error: err instanceof Error ? err.message : String(err) },
				);
				res.redirect(303, ACCOUNT_ERROR_PAYMENT_METHOD_URL);
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
		await subscribeBranches[branch](req, res);
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
		case "pending_cancellation":
			return "cancelled";
		default:
			return "forbidden";
	}
}
