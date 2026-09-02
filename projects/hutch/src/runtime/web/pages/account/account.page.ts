import assert from "node:assert";
import type { Request, Response, Router } from "express";
import express from "express";
import type { HutchLogger } from "@packages/hutch-logger";
import { SESSION_COOKIE_NAME } from "@packages/web-session";
import type {
	DestroyUserSessions,
	FindEmailByUserId,
	MarkAccountDeleted,
} from "@packages/provider-contracts/auth";
import type { RevokeAllUserOAuthTokens } from "@packages/provider-contracts/oauth";
import type {
	CreateCheckoutSession,
	CheckoutSessionId,
} from "@packages/provider-contracts/hosted-checkout";
import type {
	FindSubscriptionByUserId,
	MarkSubscriptionActive,
	SetSubscriptionNextCharge,
	SubscriptionRecord,
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
	FindSubscriptionNextCharge,
	ReverseScheduledCancellation,
	SubscriptionNextCharge,
} from "@packages/provider-contracts/subscription-billing";
import {
	type BeginAddCard,
	CardSetupIdSchema,
	type GetCardSetupResult,
	type ListCards,
	PaymentMethodIdSchema,
	type RemoveCard,
	type SetPrimaryCard,
} from "@packages/provider-contracts/payment-methods";
import type {
	CreateChargeReminderSchedule,
	DeleteDeferredCancellationSchedule,
} from "@packages/provider-contracts/trial-scheduler";
import type { StorePendingSignup } from "@packages/provider-contracts/pending-signup";
import {
	STRIPE_CHECKOUT_MIN_TRIAL_END_LEAD_MS,
	chargeReminderFiresAt,
} from "../../../domain/stripe/stripe-trial-config";
import { type TrialSchedulerPort, startTrial } from "../../../domain/trial/start-trial";
import { initLoadNextCharge } from "../../../domain/subscription/next-charge";
import { CHECKOUT_VARIANTS, type CheckoutVariant } from "../../../observability/events";
import type { EmitSubscriptionEvent } from "../../../observability/subscription-events";
import { Base, ChromelessPage } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { ACCOUNT_LOGOUT_HREF, APP_BACK_LINK } from "../../shared/native-app-links";
import { HxRedirectPage } from "../../hx-redirect-page";
import { requireCspNonce, sendComponent } from "@packages/web-shell";
import type { EffectiveAccess, GetEffectiveAccess } from "@packages/subscription-access";
import { AccountPage, renderAccountCard } from "./account.component";
import {
	type CardError,
	type CardSectionViewModel,
	DELETE_ACCOUNT_CONFIRMATION_FIELD,
	DELETE_ACCOUNT_CONFIRMATION_PHRASE,
	MAX_CARDS,
	buildCardSectionViewModel,
	parseAccountQuery,
	toAccountViewModel,
	withoutCommerce,
} from "./account.view-model";
import { isAppShell, isNativeSurface, nativeSurfaceOf } from "../../onboarding/native-client";
import {
	ACCOUNT_ERROR_ADD_CARD_FAILED_URL,
	ACCOUNT_ERROR_CANNOT_REMOVE_PRIMARY_URL,
	ACCOUNT_ERROR_CARD_LIMIT_URL,
	ACCOUNT_ERROR_CARD_SETUP_FAILED_URL,
	ACCOUNT_ERROR_CARD_SETUP_UNVERIFIED_URL,
	ACCOUNT_ERROR_PAYMENT_METHOD_URL,
	buildAccountUrl,
} from "./account.url";

interface AccountDependencies {
	getEffectiveAccess: GetEffectiveAccess;
	findSubscriptionByUserId: FindSubscriptionByUserId;
	findSubscriptionNextCharge: FindSubscriptionNextCharge;
	setSubscriptionNextCharge: SetSubscriptionNextCharge;
	upsertActiveSubscription: UpsertActiveSubscription;
	upsertTrialingSubscription: UpsertTrialingSubscription;
	markActiveSubscription: MarkSubscriptionActive;
	findEmailByUserId: FindEmailByUserId;
	destroyUserSessions: DestroyUserSessions;
	markAccountDeleted: MarkAccountDeleted;
	revokeAllUserOAuthTokens: RevokeAllUserOAuthTokens;
	publishDeleteAccountCommand: PublishDeleteAccountCommand;
	publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand;
	publishSubscriptionReactivated: PublishSubscriptionReactivated;
	createCheckoutSession: CreateCheckoutSession;
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
	reverseScheduledCancellation: ReverseScheduledCancellation;
	listCards: ListCards;
	beginAddCard: BeginAddCard;
	getCardSetupResult: GetCardSetupResult;
	removeCard: RemoveCard;
	setPrimaryCard: SetPrimaryCard;
	stripePublishableKey: string | undefined;
	trialScheduler: TrialSchedulerPort;
	createChargeReminderSchedule: CreateChargeReminderSchedule;
	deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
	storePendingSignup: StorePendingSignup;
	stripePriceId: string;
	buildCheckoutSuccessUrl: (sessionIdPlaceholder: string) => string;
	appOrigin: string;
	logger: HutchLogger;
	now: () => Date;
	buildBannerState: BuildBannerState;
	emitSubscriptionEvent: Pick<EmitSubscriptionEvent, "checkoutStarted" | "resubscribeCompleted">;
}

type SubscribeBranchKey = "trialing" | "cancelled" | "noop" | "forbidden";

export function initAccountRoutes(deps: AccountDependencies): Router {
	const router = express.Router();

	const loadNextCharge = initLoadNextCharge({
		findSubscriptionNextCharge: deps.findSubscriptionNextCharge,
		setSubscriptionNextCharge: deps.setSubscriptionNextCharge,
		logger: deps.logger,
		now: deps.now,
	});

	/** Server-authoritative card section. The live card set is re-read from the
	 * provider on every render and every mutation — the UI is never trusted. */
	async function loadCardSection(input: {
		customerId: string | undefined;
		subscriptionId: string | undefined;
		access: EffectiveAccess;
		cardError: CardError | undefined;
		adding: { clientSecret: string; setupId: string } | undefined;
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
			nextCharge: SubscriptionNextCharge | undefined;
		},
	): Promise<void> {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const email = await deps.findEmailByUserId(req.userId);
		assert(email, "an authenticated account page must resolve an email");
		const webVm = toAccountViewModel(
			input.access,
			parseAccountQuery(req.query),
			deps.now(),
			input.nextCharge,
		);
		// Inside the app's web sheet every nav and footer link would yank the user out
		// into their OS default browser, where they are not signed in — so the app
		// shell gets the same chromeless page the reader does, with a deep link back
		// to the native list as its only navigation.
		if (isAppShell(req)) {
			sendComponent(
				req, res,
				ChromelessPage(
					AccountPage(
						withoutCommerce(webVm, { appShell: true, platform: nativeSurfaceOf(req) }),
						input.cardSection,
						{
							email,
							surface: { backLink: { href: APP_BACK_LINK.topHref, label: APP_BACK_LINK.label } },
						},
					),
					{ cspNonce: requireCspNonce(req) },
				),
			);
			return;
		}
		const vm = isNativeSurface(req)
			? withoutCommerce(webVm, { appShell: false, platform: nativeSurfaceOf(req) })
			: webVm;
		const bannerState = await deps.buildBannerState(req, { preFetchedAccess: input.access });
		sendComponent(req, res, Base(AccountPage(vm, input.cardSection, { email }), bannerState));
	}

	router.get("/", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const access = await deps.getEffectiveAccess(req.userId);
		if (isNativeSurface(req)) {
			// The iOS surface hides the payment-methods section and the renewal line, so
			// skip the live provider reads whose results would only be discarded.
			await renderAccount(req, res, {
				access,
				cardSection: buildCardSectionViewModel({ kind: "no-customer" }),
				nextCharge: undefined,
			});
			return;
		}
		const query = parseAccountQuery(req.query);
		const row = await deps.findSubscriptionByUserId(req.userId);
		const cardSection = await loadCardSection({
			customerId: row?.customerId,
			subscriptionId: row?.subscriptionId,
			access,
			cardError: query.cardError,
			adding: undefined,
		});
		const nextCharge = await loadNextCharge({
			userId: req.userId,
			row,
			suppressed: query.cancelling || query.errorPaymentMethod,
		});
		await renderAccount(req, res, { access, cardSection, nextCharge });
	});

	router.get("/status", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const access = await deps.getEffectiveAccess(req.userId);
		const webVm = toAccountViewModel(access, parseAccountQuery(req.query), deps.now());
		const vm = isNativeSurface(req)
			? withoutCommerce(webVm, { appShell: isAppShell(req), platform: nativeSurfaceOf(req) })
			: webVm;
		res.set("Cache-Control", "private, no-cache");
		res.set("Vary", "Cookie");
		res.status(200).type("html").send(renderAccountCard(vm));
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
			const { clientSecret, setupId } = await deps.beginAddCard({ customerId: row.customerId });
			const cardSection = buildCardSectionViewModel({
				kind: "loaded",
				cards,
				publishableKey,
				cardError: undefined,
				adding: { clientSecret, setupId },
			});
			/* Whatever the row already knows, so the renewal line does not blink out
			 * while a card is being added. Adding a card is not a reason to re-ask the
			 * provider for a price. */
			await renderAccount(req, res, { access, cardSection, nextCharge: row.nextCharge });
		} catch (err) {
			deps.logger.error("[account/cards/new] failed", {
				userId,
				error: err instanceof Error ? err.message : String(err),
			});
			res.redirect(303, ACCOUNT_ERROR_ADD_CARD_FAILED_URL);
		}
	});

	/** The card is attached client-side when Stripe.js confirms the SetupIntent,
	 * out of the server's sight — so the posted setup id is re-verified against
	 * the provider before the card is accepted, and the cap is re-checked
	 * because a second tab can out-race the begin-time check in /cards/new. */
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
			const customerId = row.customerId;
			const parsed = CardSetupIdSchema.safeParse(req.body?.setupId);
			if (!parsed.success) {
				res.redirect(303, buildAccountUrl());
				return;
			}
			const setup = await deps.getCardSetupResult({ setupId: parsed.data });
			const ownCardId = setup.customerId === customerId ? setup.cardId : undefined;
			if (setup.status !== "succeeded" || ownCardId === undefined) {
				deps.logger.warn("[account/cards/confirm] card setup verification failed", {
					userId,
					status: setup.status,
					customerMatched: setup.customerId === customerId,
					failureReason: setup.failureReason,
				});
				if (ownCardId !== undefined) {
					const cards = await deps.listCards({
						customerId,
						subscriptionId: row.subscriptionId,
					});
					const attached = cards.find((card) => card.id === ownCardId && !card.isPrimary);
					if (attached) {
						await deps.removeCard({ customerId, cardId: attached.id });
					}
				}
				res.redirect(303, ACCOUNT_ERROR_CARD_SETUP_FAILED_URL);
				return;
			}
			const cards = await deps.listCards({
				customerId,
				subscriptionId: row.subscriptionId,
			});
			if (cards.length <= MAX_CARDS) {
				res.redirect(303, buildAccountUrl());
				return;
			}
			const surplus = cards.find((card) => card.id === ownCardId && !card.isPrimary);
			if (!surplus) {
				res.redirect(303, buildAccountUrl());
				return;
			}
			await deps.removeCard({ customerId, cardId: surplus.id });
			res.redirect(303, ACCOUNT_ERROR_CARD_LIMIT_URL);
		} catch (err) {
			deps.logger.error("[account/cards/confirm] failed", {
				userId,
				error: err instanceof Error ? err.message : String(err),
			});
			res.redirect(303, ACCOUNT_ERROR_CARD_SETUP_UNVERIFIED_URL);
		}
	});

	router.post("/cancel", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		await deps.publishCancelSubscriptionCommand({ userId: req.userId });
		res.redirect(
			303,
			buildAccountUrl({
				cancelling: true,
				surfacePlatform: nativeSurfaceOf(req),
				appShell: isAppShell(req),
			}),
		);
	});

	/** Irreversible account deletion. The synchronous work here revokes every
	 * *existing* credential the instant the user confirms — all sessions and bearer
	 * tokens die at once — after which the durable, at-least-once scrub of every
	 * user-owned store runs asynchronously via DeleteAccountCommand. Sessions
	 * are destroyed before tokens are revoked (mirroring /oauth/revoke) so a failed
	 * step leaves the account still usable for a safe retry rather than
	 * half-torn-down. */
	router.post("/delete", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		if (req.body?.[DELETE_ACCOUNT_CONFIRMATION_FIELD] !== DELETE_ACCOUNT_CONFIRMATION_PHRASE) {
			// Thread the surface through the POST-Redirect-GET like /cancel does, so a
			// rejected delete on the iOS in-app surface re-renders commerce-free rather
			// than bouncing to the web surface with its subscribe CTAs (Guideline 3.1.1).
			res.redirect(
				303,
				buildAccountUrl({
					deleteConfirmationError: true,
					surfacePlatform: nativeSurfaceOf(req),
					appShell: isAppShell(req),
				}),
			);
			return;
		}
		await deps.markAccountDeleted({ userId, at: deps.now().toISOString() });
		await deps.destroyUserSessions(userId);
		await deps.revokeAllUserOAuthTokens(userId);
		res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
		await deps.publishDeleteAccountCommand({ userId });
		// Deletion logs the user out, so the whole page (nav, banner) must reset to
		// the guest view. A boosted form would only swap <main> and leave a stale
		// signed-in chrome, so force a full navigation to the logged-out home —
		// HX-Redirect for HTMX requests, a plain 303 otherwise. Inside the app's web
		// sheet there is no chrome to reset and the logged-out marketing home would be
		// nonsense, so the app shell is sent a deep link its navigation delegate
		// intercepts: it dismisses the sheet and signs the app out locally.
		redirectFullPage(req, res, isAppShell(req) ? ACCOUNT_LOGOUT_HREF : "/");
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

			if (row.subscriptionId) {
				// Paid path — Stripe still owns the subscription; tell it to stop
				// the scheduled cancel, then flip the row back to active. The
				// deferred-cancellation schedule has to go first or it fires later,
				// dispatches CancelSubscriptionCommand against the now-active row and
				// re-cancels the user. (The trial path below deletes it via
				// startTrial, so each branch owns its own schedule hygiene.)
				await deps.deleteDeferredCancellationSchedule({ userId });
				const reversed = await deps.reverseScheduledCancellation({
					subscriptionId: row.subscriptionId,
				});
				await deps.markActiveSubscription({ userId });
				await deps.publishSubscriptionReactivated({
					userId,
					subscriptionId: row.subscriptionId,
				});
				if (reversed.trialEndsAt) {
					try {
						await deps.createChargeReminderSchedule({
							userId,
							firesAt: chargeReminderFiresAt({
								chargeAt: reversed.trialEndsAt,
								now: deps.now(),
							}),
							chargeAt: reversed.trialEndsAt,
						});
					} catch (err) {
						deps.logger.error(
							"[reactivate] Charge-reminder schedule creation failed — continuing without the pre-charge email",
							{ userId, error: err instanceof Error ? err.message : String(err) },
						);
					}
				}
				res.redirect(303, buildAccountUrl());
				return;
			}

			// Trial path — no Stripe subscription exists, so the original window is
			// simply re-opened. A create failure throws out to the catch below,
			// leaving the row pending_cancellation for the user to retry.
			assert(
				row.trialEndsAt,
				"trial pending_cancellation row must have trialEndsAt",
			);
			await startTrial({
				mode: "reset",
				userId,
				trialEndsAt: row.trialEndsAt,
				now: deps.now(),
				upsertTrialing: deps.upsertTrialingSubscription,
				trialScheduler: deps.trialScheduler,
			});
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
		params: { trialEndsAt: string | undefined; variant: CheckoutVariant },
	): Promise<{ id: CheckoutSessionId; url: string }> {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const email = await deps.findEmailByUserId(userId);
		assert(email, "authenticated user must have an email address");

		const checkout = await deps.createCheckoutSession({
			customerEmail: email,
			successUrl: deps.buildCheckoutSuccessUrl("{CHECKOUT_SESSION_ID}"),
			cancelUrl: `${deps.appOrigin}${buildAccountUrl()}`,
			trialEndsAt: params.trialEndsAt,
		});

		await deps.storePendingSignup({
			checkoutSessionId: checkout.id,
			signup: {
				method: "existing-user-subscribe",
				email,
				userId,
				returnUrl: "/queue",
				trialEndsAt: params.trialEndsAt,
				variant: params.variant,
			},
			createdAt: deps.now().getTime(),
		});

		deps.emitSubscriptionEvent.checkoutStarted({
			userId,
			variant: params.variant,
			checkoutSessionId: checkout.id,
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
		(req: Request, res: Response, row: SubscriptionRecord | undefined) => Promise<void>
	> = {
		trialing: async (req, res, row) => {
			assert(row, "trialing branch requires a row");
			assert(row.trialEndsAt, "trialing row must have trialEndsAt");
			const trialRemainingMs = Date.parse(row.trialEndsAt) - deps.now().getTime();
			const checkout = await startCheckout(req, {
				trialEndsAt:
					trialRemainingMs >= STRIPE_CHECKOUT_MIN_TRIAL_END_LEAD_MS
						? row.trialEndsAt
						: undefined,
				variant: CHECKOUT_VARIANTS.trialCheckout,
			});
			redirectFullPage(req, res, checkout.url);
		},
		cancelled: async (req, res, row) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			assert(row, "cancelled branch requires a row");
			if (!row.customerId) {
				deps.logger.warn(
					"[subscribe] cancelled row without customerId — falling back to checkout",
					{ userId },
				);
				const checkout = await startCheckout(req, {
					trialEndsAt: undefined,
					variant: CHECKOUT_VARIANTS.cancelledResubscribe,
				});
				redirectFullPage(req, res, checkout.url);
				return;
			}
			let subscriptionId: string;
			try {
				({ subscriptionId } = await deps.createSubscriptionOnExistingCustomer({
					customerId: row.customerId,
					priceId: deps.stripePriceId,
					userId,
					onUnpaidFirstInvoice: "refuse",
				}));
			} catch (err) {
				deps.logger.error(
					`[subscribe/cancelled] saved-card charge failed for ${userId} — falling back to checkout: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
				const checkout = await startCheckout(req, {
					trialEndsAt: undefined,
					variant: CHECKOUT_VARIANTS.cardDeclineFallback,
				});
				redirectFullPage(req, res, checkout.url);
				return;
			}
			await deps.upsertActiveSubscription({
				userId,
				subscriptionId,
				customerId: row.customerId,
			});
			deps.emitSubscriptionEvent.resubscribeCompleted({ userId, subscriptionId });
			res.redirect(303, buildAccountUrl());
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
			await subscribeBranches[branch](req, res, row);
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
