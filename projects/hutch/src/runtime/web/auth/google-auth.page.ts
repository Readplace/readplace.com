import { randomBytes } from "node:crypto";
import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import type {
	CreateGoogleUser,
	CreateSession,
	FindUserByEmail,
	MarkEmailVerified,
} from "@packages/provider-contracts/auth";
import type { SendEmail } from "@packages/provider-contracts/email";
import type { ExchangeGoogleCode } from "@packages/provider-contracts/google-auth";
import type { UpsertTrialingSubscription } from "@packages/provider-contracts/subscription-providers";
import {
	type TrialSchedulerPort,
	startTrial,
	trialEndsAtFromNow,
} from "../../domain/trial/start-trial";
import { initSendWelcomeEmail } from "./send-welcome-email";
import { type ResolveSignupClient, signupClientOrOther } from "./signup-client";
import type { EmitLifecycleEmailSent } from "../../observability/lifecycle-email-events";

import { extractReturnUrl, parseReturnUrl } from "./parse-return-url";
import { oauthClientIdFrom } from "./oauth-client-id";
import { defineCookie } from "@packages/web-analytics";
import { oauthCallbackResponses } from "./oauth-callback-responses";
import { readClickAttribution } from "@packages/web-analytics";
import type { RecordAudienceEvent } from "@packages/web-analytics";
import { consumePendingSaveId } from "../pending-save";
import type { ConversionEvent } from "../../conversions";
import { buildUserCreatedEvent } from "../../conversions";
import { readHomepageVariantSlug } from "../experiments/homepage-assignment";
import { signState, verifyState } from "./oauth-state";
import type { Logger, LogError } from "@packages/logger";
import type { RateLimitRule } from "@packages/domain/rate-limit";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";
import { initClaimSignupAllowance } from "./signup-allowance";

const CallbackQuerySchema = z.object({
	code: z.string().min(1),
	state: z.string().min(1),
});

const StatePayloadSchema = z.object({
	nonce: z.string(),
	returnUrl: z.string().optional(),
	createdAt: z.number(),
});

const STATE_COOKIE = "hutch_gstate";
const STATE_TTL_MS = 5 * 60 * 1000;
const googleStateCookie = defineCookie({ name: STATE_COOKIE, maxAgeMs: STATE_TTL_MS, sameSite: "lax", httpOnly: true, schema: z.string() });

interface GoogleAuthDependencies {
	googleClientId: string;
	googleClientSecret: string;
	appOrigin: string;
	baseUrl: string;
	staticBaseUrl: string;
	secureCookies: boolean;
	createSession: CreateSession;
	createGoogleUser: CreateGoogleUser;
	findUserByEmail: FindUserByEmail;
	markEmailVerified: MarkEmailVerified;
	exchangeGoogleCode: ExchangeGoogleCode;
	upsertTrialing: UpsertTrialingSubscription;
	trialScheduler: TrialSchedulerPort;
	sendEmail: SendEmail;
	logError: LogError;
	now: () => Date;
	recordConversionEvent: RecordAudienceEvent<ConversionEvent>;
	emitLifecycleEmailSent: EmitLifecycleEmailSent;
	resolveSignupClient: ResolveSignupClient;
	signUnsubscribeToken: (userId: UserId) => string;
	consumeRateLimit: ConsumeRateLimit;
	signupCreatedRule: RateLimitRule;
	logger: Logger;
}

export const initGoogleAuthRoutes = (deps: GoogleAuthDependencies): Router => {
	const router = express.Router();
	const redirectUri = `${deps.appOrigin}/auth/google/callback`;
	const claimSignupAllowance = initClaimSignupAllowance({
		consumeRateLimit: deps.consumeRateLimit,
		rule: deps.signupCreatedRule,
	});
	const sendWelcomeEmail = initSendWelcomeEmail({
		sendEmail: deps.sendEmail,
		baseUrl: deps.baseUrl,
		staticBaseUrl: deps.staticBaseUrl,
		logError: deps.logError,
		emitLifecycleEmailSent: deps.emitLifecycleEmailSent,
		now: deps.now,
		signUnsubscribeToken: deps.signUnsubscribeToken,
	});

	router.get("/auth/google", (req: Request, res: Response) => {
		const returnUrl = extractReturnUrl(req.query);
		const nonce = randomBytes(16).toString("hex");
		const createdAt = Date.now();
		const statePayload = JSON.stringify({ nonce, returnUrl, createdAt });
		const signedState = signState({ payload: statePayload, secret: deps.googleClientSecret });

		googleStateCookie.set({ res, value: signedState, secure: deps.secureCookies });

		const params = new URLSearchParams({
			client_id: deps.googleClientId,
			redirect_uri: redirectUri,
			response_type: "code",
			scope: "openid email",
			state: signedState,
		});
		// Forwarded only from the "use a different account" switch, so Google shows
		// its own account chooser instead of auto-selecting its single signed-in one.
		if (req.query.prompt === "select_account") params.set("prompt", "select_account");

		res.redirect(303, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
	});

	router.get("/auth/google/callback", async (req: Request, res: Response) => {
		const parsedQuery = CallbackQuerySchema.safeParse(req.query);
		const stateCookie = req.cookies?.[STATE_COOKIE];

		res.clearCookie(STATE_COOKIE, { path: "/" });

		const { renderError, renderAllowanceSpent, signIn } = oauthCallbackResponses({ req, res, provider: "google", deps });

		if (!parsedQuery.success || !stateCookie || parsedQuery.data.state !== stateCookie) {
			renderError({ message: "Google sign-in failed. Please try again.", reason: "callback_invalid" });
			return;
		}
		const { code, state: stateParam } = parsedQuery.data;

		const payload = verifyState({ signed: stateParam, secret: deps.googleClientSecret });
		if (!payload) {
			renderError({ message: "Google sign-in failed. Please try again.", reason: "callback_invalid" });
			return;
		}

		const stateData = StatePayloadSchema.parse(JSON.parse(payload));
		if (Date.now() - stateData.createdAt > STATE_TTL_MS) {
			renderError({ message: "Google sign-in expired. Please try again.", reason: "expired" });
			return;
		}

		let tokenResult: Awaited<ReturnType<ExchangeGoogleCode>>;
		try {
			tokenResult = await deps.exchangeGoogleCode(code);
		} catch (error) {
			deps.logError("[Google Auth] Token exchange failed", error instanceof Error ? error : new Error(String(error)));
			renderError({ message: "Google sign-in failed. Please try again." });
			return;
		}

		if (!tokenResult.emailVerified) {
			renderError({ message: "Your Google account email is not verified." });
			return;
		}

		const existing = await deps.findUserByEmail(tokenResult.email);
		if (existing) {
			if (!existing.emailVerified) {
				await deps.markEmailVerified(tokenResult.email);
			}
			const sessionId = await deps.createSession({ userId: existing.userId, emailVerified: true });
			signIn(sessionId);
			res.redirect(303, parseReturnUrl({ return: stateData.returnUrl }));
			return;
		}

		const newUserId = UserIdSchema.parse(randomBytes(16).toString("hex"));
		const safeReturnUrl = extractReturnUrl({ return: stateData.returnUrl });
		const oauthClientId = oauthClientIdFrom(safeReturnUrl);
		const signupOAuthClientId = oauthClientId ?? null;
		const welcomeSignupClient = () =>
			signupClientOrOther({
				resolve: () => deps.resolveSignupClient(signupOAuthClientId),
				logError: deps.logError,
			});

		const allowance = await claimSignupAllowance(req);
		if (!allowance.allowed) {
			renderAllowanceSpent({ returnUrl: safeReturnUrl, retryAfterSeconds: allowance.retryAfterSeconds });
			return;
		}
		/* Read once, then persisted on the user row (durable) AND emitted on the
		 * user_created conversion event (30-day retention). */
		const attribution = readClickAttribution(req);
		const created = await deps.createGoogleUser({
			email: tokenResult.email,
			userId: newUserId,
			attribution,
			signupOAuthClientId,
		});
		if (!created.ok) {
			const lookup = await deps.findUserByEmail(tokenResult.email);
			if (lookup) {
				if (!lookup.emailVerified) {
					await deps.markEmailVerified(tokenResult.email);
				}
				const sessionIdRace = await deps.createSession({ userId: lookup.userId, emailVerified: true });
				signIn(sessionIdRace);
				res.redirect(303, parseReturnUrl({ return: safeReturnUrl }));
				return;
			}
			renderError({ message: "Account creation failed. Please try again." });
			return;
		}

		const trialEndsAt = trialEndsAtFromNow(deps.now());
		await startTrial({
			mode: "signup",
			userId: created.userId,
			trialEndsAt,
			now: deps.now(),
			upsertTrialing: deps.upsertTrialing,
			trialScheduler: deps.trialScheduler,
			logError: deps.logError,
		});

		const sessionId = await deps.createSession({ userId: created.userId, emailVerified: true });
		signIn(sessionId);
		await sendWelcomeEmail({ email: tokenResult.email, userId: created.userId, signupClient: await welcomeSignupClient(), tier: "trial", trialEndsAt });
		deps.recordConversionEvent(
			req,
			buildUserCreatedEvent(
				{ now: deps.now },
				{
					userId: created.userId,
					email: tokenResult.email,
					method: "google",
					tier: "trial",
					attribution: readClickAttribution(req),
					homepageVariant: readHomepageVariantSlug(req),
					visitorId: req.visitorId,
					pendingSaveId: consumePendingSaveId({ req, res }),
					oauthClientId,
				},
			),
		);
		res.redirect(303, parseReturnUrl({ return: safeReturnUrl }));
	});

	return router;
};
