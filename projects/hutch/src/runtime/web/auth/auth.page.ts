import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import type {
	CountUsers,
	CreateSession,
	CreateUserWithPasswordHash,
	DestroySession,
	FindUserByEmail,
	MarkEmailVerified,
	MarkSessionEmailVerified,
	VerifyCredentials,
} from "@packages/provider-contracts/auth";
import type { UserId } from "@packages/domain/user";
import type { ValidateAccessToken } from "@packages/provider-contracts/oauth";
import { AccessTokenSchema } from "@packages/domain/oauth";
import type { SendEmail } from "@packages/provider-contracts/email";
import type {
	CreateVerificationToken,
	VerifyEmailToken,
} from "@packages/provider-contracts/email-verification";
import { VerificationTokenSchema } from "@packages/provider-contracts/email-verification";
import assert from "node:assert";
import type { ConsumePendingSignup } from "@packages/provider-contracts/pending-signup";
import type {
	UpsertActiveSubscription,
	UpsertTrialingSubscription,
} from "@packages/provider-contracts/subscription-providers";
import type {
	CreateChargeReminderSchedule,
	CreateTrialEndSchedule,
	CreateTrialReminderSchedule,
	DeleteTrialEndSchedule,
	DeleteTrialReminderSchedule,
} from "@packages/provider-contracts/trial-scheduler";
import {
	CheckoutSessionIdSchema,
	type CheckoutSessionId,
	type RetrieveCheckoutSession,
} from "@packages/provider-contracts/hosted-checkout";
import type {
	ConsumeRateLimit,
	RateLimitRules,
} from "@packages/provider-contracts/rate-limit";
import { createRateLimitMiddleware, sendRateLimited } from "../middleware/rate-limit";
import { normalizeEmail } from "@packages/domain/user";
import {
	STRIPE_TRIAL_PERIOD_DAYS,
	chargeReminderFiresAt,
	trialReminderFiresAt,
} from "../../domain/stripe/stripe-trial-config";
import { Base } from "../base.component";
import { bannerStateFromRequest, sendComponent } from "@packages/web-shell";
import type { BuildBannerState } from "../banner-state";

import type { ComponentError } from "../shared/component-error.types";
import { LoginSchema } from "./auth.schema";
import { LoginPage, SignupPage, VerifyEmailPage } from "./auth.component";
import { extractReturnUrl, parseReturnUrl } from "./parse-return-url";
import { pendingSaveHostFrom } from "./pending-save-host";
import { baseCookieOptions, suppressClickCount } from "@packages/web-analytics";
import { SESSION_COOKIE_MAX_AGE_MS, SESSION_COOKIE_NAME } from "@packages/web-session";
import { buildVerificationEmailHtml } from "./verification-email";
import { flattenZodErrors } from "./flatten-zod-errors";
import { initFetchUserCount } from "./fetch-user-count";
import { initSendWelcomeEmail } from "./send-welcome-email";
import { createBotDefenseEvent } from "./bot-defense-event";
import { initValidateSignup } from "./validate-signup";
import type { FoundingAllocation } from "../shared/founding-progress/founding-allocation";
import { readClickAttribution } from "@packages/web-analytics";
import { consumePendingSaveId } from "../pending-save";
import type { ConversionEvent } from "../../conversions";
import { emitUserCreated } from "../../conversions";
import type { AnalyticsEvent } from "@packages/web-analytics";
import { buildSignupAttemptedEvent } from "@packages/web-analytics";
import { SIGNUP_OUTCOMES, type SignupOutcome } from "../../observability/events";
import {
	CHECKOUT_RETURN_FAILURE_REASONS,
	type CheckoutReturnFailureReason,
} from "../../observability/events";
import type { EmitSubscriptionEvent } from "../../observability/subscription-events";
import { DISPOSABLE_EMAIL_MESSAGE } from "./disposable-email";

const TokenQuerySchema = z.object({ token: z.string().optional() }).passthrough();
const CheckoutSuccessQuerySchema = z.object({ session_id: z.string().min(1) }).passthrough();
const SignupQuerySchema = z.object({ email: z.string().email() }).passthrough();

const EMAIL_FROM = "Fayner Brack <readplace@readplace.com>";

import type { BotDefenseEvent } from "@packages/provider-contracts/auth";
export type { BotDefenseEvent };

interface AuthDependencies {
	hashPassword: (password: string) => Promise<string>;
	createUserWithPasswordHash: CreateUserWithPasswordHash;
	findUserByEmail: FindUserByEmail;
	verifyCredentials: VerifyCredentials;
	validateAccessToken: ValidateAccessToken;
	createSession: CreateSession;
	destroySession: DestroySession;
	countUsers: CountUsers;
	markEmailVerified: MarkEmailVerified;
	markSessionEmailVerified: MarkSessionEmailVerified;
	sendEmail: SendEmail;
	createVerificationToken: CreateVerificationToken;
	verifyEmailToken: VerifyEmailToken;
	retrieveCheckoutSession: RetrieveCheckoutSession;
	consumePendingSignup: ConsumePendingSignup;
	subscriptionProviders: {
		upsertActive: UpsertActiveSubscription;
		upsertTrialing: UpsertTrialingSubscription;
	};
	trialScheduler: {
		createTrialEndSchedule: CreateTrialEndSchedule;
		deleteTrialEndSchedule: DeleteTrialEndSchedule;
		createTrialReminderSchedule: CreateTrialReminderSchedule;
		deleteTrialReminderSchedule: DeleteTrialReminderSchedule;
		createChargeReminderSchedule: CreateChargeReminderSchedule;
	};
	baseUrl: string;
	staticBaseUrl: string;
	secureCookies: boolean;
	logError: (message: string, error?: Error) => void;
	now: () => Date;
	botDefenseLogger: HutchLogger.Typed<BotDefenseEvent>;
	conversionLogger: HutchLogger.Typed<ConversionEvent>;
	analytics: HutchLogger.Typed<AnalyticsEvent>;
	salt: string;
	emitSubscriptionEvent: Pick<
		EmitSubscriptionEvent,
		"checkoutCompleted" | "checkoutReturnFailed"
	>;
	foundingAllocation: FoundingAllocation;
	buildBannerState: BuildBannerState;
	consumeRateLimit: ConsumeRateLimit;
	rateLimitRules: Pick<RateLimitRules, "login" | "loginAccount" | "signup">;
}

export function initAuthRoutes(deps: AuthDependencies): Router {
	const router = express.Router();
	const sessionCookieOptions = { ...baseCookieOptions(deps.secureCookies), maxAge: SESSION_COOKIE_MAX_AGE_MS };

	const fetchUserCount = initFetchUserCount({
		countUsers: deps.countUsers,
		logError: deps.logError,
		logPrefix: "[Auth]",
	});

	const validateSignup = initValidateSignup({ findUserByEmail: deps.findUserByEmail });

	const sendWelcomeEmail = initSendWelcomeEmail({
		sendEmail: deps.sendEmail,
		baseUrl: deps.baseUrl,
		staticBaseUrl: deps.staticBaseUrl,
		logError: deps.logError,
	});

	const sendVerificationEmail = (userId: UserId, email: string): void => {
		deps.createVerificationToken({ userId, email })
			.then((token) => {
				const verifyUrl = `${deps.baseUrl}/verify-email?token=${token}`;
				const html = buildVerificationEmailHtml(verifyUrl);
				return deps.sendEmail({
					from: EMAIL_FROM,
					to: email,
					bcc: "readplace+account_verifications@readplace.com",
					subject: "Verify your email — Readplace",
					html,
				});
			})
			.catch((err) => {
				deps.logError("[Email] Verification email failed", err instanceof Error ? err : new Error(String(err)));
			});
	};

	router.get("/login", async (req: Request, res: Response) => {
		if (req.userId) {
			res.redirect(303, "/queue");
			return;
		}
		const returnUrl = extractReturnUrl(req.query);
		const userCount = await fetchUserCount();
		sendComponent(req, res, Base(LoginPage({ returnUrl, pendingSaveHost: pendingSaveHostFrom(returnUrl), userCount, foundingAllocation: deps.foundingAllocation }), bannerStateFromRequest(req)));
	});

	const loginRateLimit = createRateLimitMiddleware({
		consumeRateLimit: deps.consumeRateLimit,
		bucket: "login",
		rule: deps.rateLimitRules.login,
	});
	router.post("/login", loginRateLimit, async (req: Request, res: Response) => {
		const returnUrl = extractReturnUrl(req.query);
		const pendingSaveHost = pendingSaveHostFrom(returnUrl);
		const parsed = LoginSchema.safeParse(req.body);

		if (!parsed.success) {
			const userCount = await fetchUserCount();
			sendComponent(
				req, res,
				Base(LoginPage(
					{
						returnUrl,
						pendingSaveHost,
						userCount,
						foundingAllocation: deps.foundingAllocation,
						email: req.body?.email,
						errors: flattenZodErrors(parsed.error.issues),
					},
					{ statusCode: 422 },
				), bannerStateFromRequest(req)),
			);
			return;
		}

		const { email, password } = parsed.data;

		const accountDecision = await deps.consumeRateLimit({
			bucket: "login-account",
			key: normalizeEmail(email),
			rule: deps.rateLimitRules.loginAccount,
		});
		if (!accountDecision.allowed) {
			sendRateLimited(res, accountDecision.retryAfterSeconds);
			return;
		}

		const credentials = await deps.verifyCredentials({ email, password });

		if (!credentials.ok) {
			const userCount = await fetchUserCount();
			sendComponent(
				req, res,
				Base(LoginPage(
					{
						returnUrl,
						pendingSaveHost,
						userCount,
						foundingAllocation: deps.foundingAllocation,
						email,
						errors: [{ message: "Invalid email or password" }],
					},
					{ statusCode: 422 },
				), bannerStateFromRequest(req)),
			);
			return;
		}

		const sessionId = await deps.createSession({ userId: credentials.userId, emailVerified: credentials.emailVerified });
		res.cookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions);
		res.redirect(303, parseReturnUrl(req.query));
	});

	router.get("/signup", async (req: Request, res: Response) => {
		if (req.userId) {
			res.redirect(303, "/queue");
			return;
		}
		const returnUrl = extractReturnUrl(req.query);
		const userCount = await fetchUserCount();
		const parsed = SignupQuerySchema.safeParse(req.query);
		const email = parsed.success ? parsed.data.email : undefined;
		sendComponent(req, res, Base(SignupPage({ returnUrl, pendingSaveHost: pendingSaveHostFrom(returnUrl), userCount, foundingAllocation: deps.foundingAllocation, loadedAt: deps.now().getTime(), email }), bannerStateFromRequest(req)));
	});

	const signupRateLimit = createRateLimitMiddleware({
		consumeRateLimit: deps.consumeRateLimit,
		bucket: "signup",
		rule: deps.rateLimitRules.signup,
	});
	router.post("/signup", signupRateLimit, async (req: Request, res: Response) => {
		const returnUrl = extractReturnUrl(req.query);
		const pendingSaveHost = pendingSaveHostFrom(returnUrl);
		const body = (req.body ?? {}) as Record<string, unknown>;

		const logSignupAttempt = (outcome: SignupOutcome) =>
			deps.analytics.info(
				buildSignupAttemptedEvent({ now: deps.now, salt: deps.salt }, { req, outcome }),
			);

		const renderFailure = async (email: string | undefined, errors: ComponentError[]) => {
			const userCount = await fetchUserCount();
			sendComponent(
				req, res,
				Base(SignupPage(
					{
						returnUrl,
						pendingSaveHost,
						userCount,
						foundingAllocation: deps.foundingAllocation,
						loadedAt: deps.now().getTime(),
						email,
						errors,
					},
					{ statusCode: 422 },
				), bannerStateFromRequest(req)),
			);
		};

		const result = await validateSignup({ body, nowMs: deps.now().getTime() });

		if (!result.ok) {
			switch (result.kind) {
				case "bot-rejected":
					deps.botDefenseLogger.info(createBotDefenseEvent({
						trip: { reason: result.reason, timeToSubmitMs: result.timeToSubmitMs },
						ip: req.ip,
						userAgent: req.get("user-agent"),
						body,
						now: deps.now(),
					}));
					if (result.reason === "submit_too_fast") {
						logSignupAttempt(SIGNUP_OUTCOMES.tooFast);
						await renderFailure(
							typeof body.email === "string" ? body.email : undefined,
							[{ message: "Please try again" }],
						);
						break;
					}
					suppressClickCount(res);
					res.redirect(303, "/?signup=pending");
					break;
				case "field-errors":
					logSignupAttempt(
						result.errors.some((e) => e.message === DISPOSABLE_EMAIL_MESSAGE)
							? SIGNUP_OUTCOMES.disposableEmail
							: SIGNUP_OUTCOMES.invalidInput,
					);
					await renderFailure(result.email, result.errors);
					break;
				case "duplicate-email":
					logSignupAttempt(SIGNUP_OUTCOMES.duplicateEmail);
					await renderFailure(result.email, [{ message: "An account with this email already exists" }]);
					break;
			}
			return;
		}

		const { email, password } = result;
		const passwordHash = await deps.hashPassword(password);
		const userCount = await fetchUserCount();
		/* Read once, then persisted on the user row (durable) AND emitted on the
		 * user_created conversion event (30-day retention). */
		const attribution = readClickAttribution(req);

		if (!deps.foundingAllocation.isFoundingAllocationExhausted(userCount)) {
			const created = await deps.createUserWithPasswordHash({ email, passwordHash, attribution });
			if (!created.ok) {
				logSignupAttempt(SIGNUP_OUTCOMES.duplicateEmail);
				await renderFailure(email, [{ message: "An account with this email already exists" }]);
				return;
			}

			const sessionId = await deps.createSession({ userId: created.userId, emailVerified: false });
			res.cookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions);
			sendVerificationEmail(created.userId, email);
			logSignupAttempt(SIGNUP_OUTCOMES.created);
			emitUserCreated(
				{ logger: deps.conversionLogger, now: deps.now },
				{
					userId: created.userId,
					email,
					method: "email",
					tier: "free",
					attribution,
					visitorId: req.visitorId,
					pendingSaveId: consumePendingSaveId({ req, res }),
				},
			);
			res.redirect(303, parseReturnUrl({ return: returnUrl }));
			return;
		}

		const created = await deps.createUserWithPasswordHash({ email, passwordHash });
		if (!created.ok) {
			logSignupAttempt(SIGNUP_OUTCOMES.duplicateEmail);
			await renderFailure(email, [{ message: "An account with this email already exists" }]);
			return;
		}

		const trialEndsAt = new Date(
			deps.now().getTime() + STRIPE_TRIAL_PERIOD_DAYS * 86_400_000,
		).toISOString();
		await deps.subscriptionProviders.upsertTrialing({
			userId: created.userId,
			trialEndsAt,
		});
		try {
			await deps.trialScheduler.createTrialEndSchedule({
				userId: created.userId,
				firesAt: trialEndsAt,
			});
		} catch (err) {
			deps.logError(
				"[Auth] Trial-end schedule creation failed — continuing without schedule",
				err instanceof Error ? err : new Error(String(err)),
			);
		}
		try {
			await deps.trialScheduler.createTrialReminderSchedule({
				userId: created.userId,
				firesAt: trialReminderFiresAt(trialEndsAt),
			});
		} catch (err) {
			deps.logError(
				"[Auth] Trial-reminder schedule creation failed — continuing without schedule",
				err instanceof Error ? err : new Error(String(err)),
			);
		}

		const sessionId = await deps.createSession({ userId: created.userId, emailVerified: false });
		res.cookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions);
		sendVerificationEmail(created.userId, email);
		logSignupAttempt(SIGNUP_OUTCOMES.created);
		emitUserCreated(
			{ logger: deps.conversionLogger, now: deps.now },
			{
				userId: created.userId,
				email,
				method: "email",
				tier: "trial",
				attribution: readClickAttribution(req),
				visitorId: req.visitorId,
				pendingSaveId: consumePendingSaveId({ req, res }),
			},
		);
		res.redirect(303, parseReturnUrl({ return: returnUrl }));
	});

	router.get("/auth/checkout/success", async (req: Request, res: Response) => {
		const renderFailure = async (params: {
			statusCode: number;
			message: string;
			reason: CheckoutReturnFailureReason;
			checkoutSessionId?: CheckoutSessionId;
		}) => {
			deps.emitSubscriptionEvent.checkoutReturnFailed({
				reason: params.reason,
				userId: req.userId,
				checkoutSessionId: params.checkoutSessionId,
			});
			const userCount = await fetchUserCount();
			sendComponent(
				req, res,
				Base(SignupPage({ userCount, foundingAllocation: deps.foundingAllocation, loadedAt: deps.now().getTime(), errors: [{ message: params.message }] }, { statusCode: params.statusCode }), bannerStateFromRequest(req)),
			);
		};

		const parsedQuery = CheckoutSuccessQuerySchema.safeParse(req.query);
		if (!parsedQuery.success) {
			await renderFailure({
				statusCode: 400,
				message: "Missing checkout session — please start again.",
				reason: CHECKOUT_RETURN_FAILURE_REASONS.invalidQuery,
			});
			return;
		}

		const checkoutSessionId = CheckoutSessionIdSchema.parse(parsedQuery.data.session_id);
		const session = await deps.retrieveCheckoutSession(checkoutSessionId);

		if (!session.ok) {
			await renderFailure({
				statusCode: 404,
				message: "Checkout session not found — please start again.",
				reason: CHECKOUT_RETURN_FAILURE_REASONS.sessionNotFound,
				checkoutSessionId,
			});
			return;
		}

		if (!session.paid || session.status !== "complete") {
			await renderFailure({
				statusCode: 402,
				message: "Payment was not completed. Please try again.",
				reason: CHECKOUT_RETURN_FAILURE_REASONS.notPaid,
				checkoutSessionId,
			});
			return;
		}

		const { subscriptionId, customerId } = session;
		assert(subscriptionId, "Stripe checkout session must carry a subscriptionId for a paid signup");
		assert(customerId, "Stripe checkout session must carry a customerId for a paid signup");

		const pending = await deps.consumePendingSignup(checkoutSessionId);
		if (!pending) {
			await renderFailure({
				statusCode: 409,
				message: "This checkout link has already been used.",
				reason: CHECKOUT_RETURN_FAILURE_REASONS.replayed,
				checkoutSessionId,
			});
			return;
		}

		await deps.subscriptionProviders.upsertActive({
			userId: pending.userId,
			subscriptionId,
			customerId,
		});
		// paid_now separates a real charge from a $0 trial capture: Stripe reports
		// no_payment_required for a trial-preserving checkout, which still counts as
		// a completed checkout but not revenue.
		deps.emitSubscriptionEvent.checkoutCompleted({
			userId: pending.userId,
			subscriptionId,
			checkoutSessionId,
			paidNow: session.paymentStatus === "paid",
			variant: pending.variant,
		});
		try {
			await deps.trialScheduler.deleteTrialEndSchedule({ userId: pending.userId });
			await deps.trialScheduler.deleteTrialReminderSchedule({ userId: pending.userId });
		} catch (err) {
			deps.logError(
				"[checkout/success] Clearing the trial schedules failed — continuing; the user has already paid and is active",
				err instanceof Error ? err : new Error(String(err)),
			);
		}
		if (pending.trialEndsAt) {
			try {
				await deps.trialScheduler.createChargeReminderSchedule({
					userId: pending.userId,
					firesAt: chargeReminderFiresAt({
						chargeAt: pending.trialEndsAt,
						now: deps.now(),
					}),
					chargeAt: pending.trialEndsAt,
				});
			} catch (err) {
				deps.logError(
					"[checkout/success] Charge-reminder schedule creation failed — continuing without the pre-charge email",
					err instanceof Error ? err : new Error(String(err)),
				);
			}
		}
		res.redirect(303, parseReturnUrl({ return: pending.returnUrl }));
	});

	router.get("/verify-email", async (req: Request, res: Response) => {
		const parsed = TokenQuerySchema.safeParse(req.query);
		const token = parsed.success ? (parsed.data.token ?? "") : "";

		if (!token) {
			sendComponent(
				req, res,
				Base(VerifyEmailPage({
					success: false,
					error: "No verification token provided.",
				}), await deps.buildBannerState(req)),
			);
			return;
		}

		const verifyResult = await deps.verifyEmailToken(VerificationTokenSchema.parse(token));

		if (!verifyResult.ok) {
			sendComponent(
				req, res,
				Base(VerifyEmailPage({
					success: false,
					error: "This verification link is invalid or has already been used.",
				}), await deps.buildBannerState(req)),
			);
			return;
		}

		await deps.markEmailVerified(verifyResult.email);
		sendWelcomeEmail(verifyResult.email);

		const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
		if (sessionId) {
			await deps.markSessionEmailVerified(sessionId);
		}

		sendComponent(req, res, Base(VerifyEmailPage({ success: true }), await deps.buildBannerState(req)));
	});

	/** Mints a browser session cookie from a valid OAuth bearer token so a native
	 * client's in-app webview can reach cookie-authenticated pages — the reader at
	 * /queue/:id/view and its htmx poll/mutation XHRs resolve ownership from the
	 * hutch_sid session, never from a bearer. Grants no new privilege (the bearer
	 * already authorizes the full API) and is CSRF-safe because browsers never
	 * auto-attach bearer tokens. The auth router is not behind dualAuth, so the
	 * endpoint validates the bearer itself; 204 with no redirect keeps it free of
	 * an open-redirect surface and reusable for any future authenticated webview. */
	router.post("/auth/session", async (req: Request, res: Response) => {
		const header = req.headers.authorization;
		if (!header?.startsWith("Bearer ")) {
			res.status(401).set("WWW-Authenticate", "Bearer").end();
			return;
		}
		const validated = await deps.validateAccessToken(AccessTokenSchema.parse(header.slice(7)));
		if (!validated) {
			res.status(401).set("WWW-Authenticate", 'Bearer error="invalid_token"').end();
			return;
		}
		const sessionId = await deps.createSession({
			userId: validated.userId,
			emailVerified: validated.emailVerified,
		});
		res.cookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions);
		res.status(204).end();
	});

	router.post("/logout", async (req: Request, res: Response) => {
		const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
		if (sessionId) {
			await deps.destroySession(sessionId);
		}
		res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
		res.redirect(303, "/");
	});

	return router;
}
