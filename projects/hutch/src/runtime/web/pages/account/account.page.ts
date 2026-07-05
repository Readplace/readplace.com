import assert from "node:assert";
import type { Request, Response, Router } from "express";
import express from "express";
import type { HutchLogger } from "@packages/hutch-logger";
import { SESSION_COOKIE_NAME } from "@packages/web-session";
import type { DestroyUserSessions, FindEmailByUserId } from "@packages/provider-contracts/auth";
import type { RevokeAllUserOAuthTokens } from "@packages/provider-contracts/oauth";
import type {
	CreateCheckoutSession,
	CheckoutSessionId,
} from "@packages/provider-contracts/stripe-checkout";
import type {
	FindSubscriptionByUserId,
	MarkSubscriptionActive,
	UpsertActiveSubscription,
	UpsertTrialingSubscription,
} from "@packages/provider-contracts/subscription-providers";
import type {
	PublishCancelSubscriptionCommand,
	PublishDeleteAccountCommand,
	PublishSubscriptionReactivated,
} from "@packages/provider-contracts/events";
import type {
	CreateSubscriptionOnExistingCustomer,
	ReverseScheduledCancellation,
} from "@packages/provider-contracts/stripe-subscriptions";
import {
	type BeginAddCard,
	type ListCards,
	PaymentMethodIdSchema,
	type RemoveCard,
	type SetPrimaryCard,
} from "@packages/provider-contracts/payment-methods";
import type {
	CreateTrialEndSchedule,
	DeleteDeferredCancellationSchedule,
} from "@packages/provider-contracts/trial-scheduler";
import type { StorePendingSignup } from "@packages/provider-contracts/pending-signup";
import { Base } from "../../base.component";
import { wantsSiren } from "../../content-negotiation";
import { SIREN_MEDIA_TYPE } from "../../api/siren";
import { toAccountEntity } from "../../api/account-siren";
import type { BuildBannerState } from "../../banner-state";
import { HxRedirectPage } from "../../hx-redirect-page";
import { sendComponent } from "@packages/web-shell";
import type { EffectiveAccess, GetEffectiveAccess } from "../../../domain/access/effective-access";
import { AccountPage } from "./account.component";
import {
	type CardError,
	type CardSectionViewModel,
	MAX_CARDS,
	buildCardSectionViewModel,
	parseAccountQuery,
	toAccountViewModel,
} from "./account.view-model";
import {
	ACCOUNT_ERROR_ADD_CARD_FAILED_URL,
	ACCOUNT_ERROR_CANNOT_REMOVE_PRIMARY_URL,
	ACCOUNT_ERROR_CARD_LIMIT_URL,
	ACCOUNT_ERROR_PAYMENT_METHOD_URL,
	buildAccountUrl,
} from "./account.url";

interface AccountDependencies {
	getEffectiveAccess: GetEffectiveAccess;
	findSubscriptionByUserId: FindSubscriptionByUserId;
	upsertActiveSubscription: UpsertActiveSubscription;
	upsertTrialingSubscription: UpsertTrialingSubscription;
	markActiveSubscription: MarkSubscriptionActive;
	findEmailByUserId: FindEmailByUserId;
	destroyUserSessions: DestroyUserSessions;
	revokeAllUserOAuthTokens: RevokeAllUserOAuthTokens;
	publishDeleteAccountCommand: PublishDeleteAccountCommand;
	publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand;
	publishSubscriptionReactivated: PublishSubscriptionReactivated;
	createCheckoutSession: CreateCheckoutSession;
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
	reverseScheduledCancellation: ReverseScheduledCancellation;
	listCards: ListCards;
	beginAddCard: BeginAddCard;
	removeCard: RemoveCard;
	setPrimaryCard: SetPrimaryCard;
	stripePublishableKey: string | undefined;
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

	/** Server-authoritative card section. The live card set is re-read from the
	 * provider on every render and every mutation — the UI is never trusted. */
	async function loadCardSection(input: {
		customerId: string | undefined;
		subscriptionId: string | undefined;
		access: EffectiveAccess;
		cardError: CardError | undefined;
		adding: { clientSecret: string } | undefined;
	}): Promise<CardSectionViewModel> {
		if (!input.customerId || input.access.access !== "full") {
			return buildCardSectionViewModel({ kind: "no-customer" });
		}
		try {
			const cards = await deps.listCards({
				customerId: input.customerId,
				subscriptionId: input.subscriptionId,
			});
			return buildCardSectionViewModel({
				kind: "loaded",
				cards,
				publishableKey: deps.stripePublishableKey,
				cardError: input.cardError,
				adding: input.adding,
			});
		} catch (err) {
			deps.logger.error("[account/cards] live read failed", {
				error: err instanceof Error ? err.message : String(err),
			});
			return buildCardSectionViewModel({ kind: "provider-error" });
		}
	}

	async function renderAccount(
		req: Request,
		res: Response,
		input: {
			access: EffectiveAccess;
			cardSection: CardSectionViewModel;
		},
	): Promise<void> {
		const vm = toAccountViewModel(input.access, parseAccountQuery(req.query), deps.now());
		const bannerState = await deps.buildBannerState(req, { preFetchedAccess: input.access });
		sendComponent(req, res, Base(AccountPage(vm, input.cardSection), bannerState));
	}

	router.get("/", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		if (wantsSiren(req)) {
			res.type(SIREN_MEDIA_TYPE).json(toAccountEntity());
			return;
		}
		const access = await deps.getEffectiveAccess(req.userId);
		const row = await deps.findSubscriptionByUserId(req.userId);
		const cardSection = await loadCardSection({
			customerId: row?.customerId,
			subscriptionId: row?.subscriptionId,
			access,
			cardError: parseAccountQuery(req.query).cardError,
			adding: undefined,
		});
		await renderAccount(req, res, { access, cardSection });
	});

	router.post("/cards/:id/primary", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		try {
			const row = await deps.findSubscriptionByUserId(userId);
			const access = await deps.getEffectiveAccess(userId);
			const parsed = PaymentMethodIdSchema.safeParse(req.params.id);
			if (!row?.customerId || access.access !== "full" || !parsed.success) {
				res.redirect(303, buildAccountUrl());
				return;
			}
			const cardId = parsed.data;
			const cards = await deps.listCards({
				customerId: row.customerId,
				subscriptionId: row.subscriptionId,
			});
			const target = cards.find((card) => card.id === cardId);
			// Unknown card or already-primary → idempotent noop; the next render
			// shows whatever the live read actually contains.
			if (!target || target.isPrimary) {
				res.redirect(303, buildAccountUrl());
				return;
			}
			await deps.setPrimaryCard({
				customerId: row.customerId,
				cardId,
				subscriptionId: row.subscriptionId,
			});
			res.redirect(303, buildAccountUrl());
		} catch (err) {
			deps.logger.error("[account/cards/primary] failed", {
				userId,
				error: err instanceof Error ? err.message : String(err),
			});
			res.redirect(303, buildAccountUrl());
		}
	});

	router.post("/cards/:id/remove", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		try {
			const row = await deps.findSubscriptionByUserId(userId);
			const access = await deps.getEffectiveAccess(userId);
			const parsed = PaymentMethodIdSchema.safeParse(req.params.id);
			if (!row?.customerId || access.access !== "full" || !parsed.success) {
				res.redirect(303, buildAccountUrl());
				return;
			}
			const cardId = parsed.data;
			const cards = await deps.listCards({
				customerId: row.customerId,
				subscriptionId: row.subscriptionId,
			});
			const target = cards.find((card) => card.id === cardId);
			if (!target) {
				res.redirect(303, buildAccountUrl());
				return;
			}
			// The primary card is never removable — the user must promote a backup
			// first so there is always exactly one primary card.
			if (target.isPrimary) {
				res.redirect(303, ACCOUNT_ERROR_CANNOT_REMOVE_PRIMARY_URL);
				return;
			}
			await deps.removeCard({ customerId: row.customerId, cardId });
			res.redirect(303, buildAccountUrl());
		} catch (err) {
			deps.logger.error("[account/cards/remove] failed", {
				userId,
				error: err instanceof Error ? err.message : String(err),
			});
			res.redirect(303, buildAccountUrl());
		}
	});

	router.post("/cards/new", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		try {
			const row = await deps.findSubscriptionByUserId(userId);
			const access = await deps.getEffectiveAccess(userId);
			const publishableKey = deps.stripePublishableKey;
			if (
				!row?.customerId ||
				access.access !== "full" ||
				publishableKey === undefined ||
				publishableKey.length === 0
			) {
				res.redirect(303, buildAccountUrl());
				return;
			}
			const cards = await deps.listCards({
				customerId: row.customerId,
				subscriptionId: row.subscriptionId,
			});
			if (cards.length >= MAX_CARDS) {
				res.redirect(303, ACCOUNT_ERROR_CARD_LIMIT_URL);
				return;
			}
			const { clientSecret } = await deps.beginAddCard({ customerId: row.customerId });
			const cardSection = buildCardSectionViewModel({
				kind: "loaded",
				cards,
				publishableKey,
				cardError: undefined,
				adding: { clientSecret },
			});
			await renderAccount(req, res, { access, cardSection });
		} catch (err) {
			deps.logger.error("[account/cards/new] failed", {
				userId,
				error: err instanceof Error ? err.message : String(err),
			});
			res.redirect(303, ACCOUNT_ERROR_ADD_CARD_FAILED_URL);
		}
	});

	/** Post-attach reconciliation. The card is attached to the customer
	 * client-side when Stripe.js confirms the SetupIntent, so the begin-time cap
	 * check in /cards/new can be out-raced by a second add opened in another tab.
	 * The client posts the just-added payment method here; we re-read the live
	 * set and, if it now exceeds MAX_CARDS, detach that card so the cap stays
	 * server-authoritative. The funding (primary) card is never detached. */
	router.post("/cards/confirm", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		try {
			const row = await deps.findSubscriptionByUserId(userId);
			const access = await deps.getEffectiveAccess(userId);
			if (!row?.customerId || access.access !== "full") {
				res.redirect(303, buildAccountUrl());
				return;
			}
			const cards = await deps.listCards({
				customerId: row.customerId,
				subscriptionId: row.subscriptionId,
			});
			if (cards.length <= MAX_CARDS) {
				res.redirect(303, buildAccountUrl());
				return;
			}
			const parsed = PaymentMethodIdSchema.safeParse(req.body?.paymentMethodId);
			const surplus = parsed.success
				? cards.find((card) => card.id === parsed.data && !card.isPrimary)
				: undefined;
			if (!surplus) {
				res.redirect(303, buildAccountUrl());
				return;
			}
			await deps.removeCard({ customerId: row.customerId, cardId: surplus.id });
			res.redirect(303, ACCOUNT_ERROR_CARD_LIMIT_URL);
		} catch (err) {
			deps.logger.error("[account/cards/confirm] failed", {
				userId,
				error: err instanceof Error ? err.message : String(err),
			});
			res.redirect(303, buildAccountUrl());
		}
	});

	router.post("/cancel", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		await deps.publishCancelSubscriptionCommand({ userId: req.userId });
		res.redirect(303, buildAccountUrl({ cancelling: true }));
	});

	/** Irreversible account deletion. The synchronous work here is the
	 * security-critical teardown that must take effect the instant the user
	 * confirms — every session and bearer token dies at once — after which the
	 * durable, at-least-once scrub of every user-owned store runs asynchronously
	 * via DeleteAccountCommand. Sessions are destroyed before tokens are revoked
	 * (mirroring /oauth/revoke) so a failed step leaves the account still usable
	 * for a safe retry rather than half-torn-down. */
	router.post("/delete", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		await deps.destroyUserSessions(userId);
		await deps.revokeAllUserOAuthTokens(userId);
		res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
		await deps.publishDeleteAccountCommand({ userId });
		// Deletion logs the user out, so the whole page (nav, banner) must reset to
		// the guest view. A boosted form would only swap <main> and leave a stale
		// signed-in chrome, so force a full navigation to the logged-out home —
		// HX-Redirect for HTMX requests, a plain 303 otherwise.
		redirectFullPage(req, res, "/");
	});

	router.post("/reactivate", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		try {
			const row = await deps.findSubscriptionByUserId(userId);
			if (row?.status !== "pending_cancellation") {
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

	/** Force the browser to fully navigate to `url` rather than swap <main>.
	 * HTMX intercepts hx-boost forms via XHR; a 303 Location to an external origin
	 * (Stripe Checkout) makes HTMX issue a cross-origin XHR and never leave the
	 * page, and a same-origin 303 only swaps <main> (leaving stale chrome — wrong
	 * after a logout-like action). HxRedirectPage carries HTMX's HX-Redirect
	 * header, which triggers `window.location.href = url`. Plain (non-HTMX) form
	 * posts still get the 303 Location, so progressive enhancement is preserved. */
	function redirectFullPage(req: Request, res: Response, url: string): void {
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
			redirectFullPage(req, res, checkout.url);
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
				redirectFullPage(req, res, checkout.url);
				return;
			}
			try {
				const { subscriptionId } = await deps.createSubscriptionOnExistingCustomer({
					customerId: row.customerId,
					priceId: deps.stripePriceId,
					userId,
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
					 * a new card. */
				deps.logger.warn(
					"[subscribe/cancelled] one-click resub failed — falling back to checkout",
					{ userId, error: err instanceof Error ? err.message : String(err) },
				);
				const checkout = await startCheckout(req);
				redirectFullPage(req, res, checkout.url);
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
