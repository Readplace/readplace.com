import { randomBytes } from "node:crypto";
import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type {
	CountUsers,
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
import type { FoundingAllocation } from "../shared/founding-progress/founding-allocation";
import { initSendWelcomeEmail } from "./send-welcome-email";
import { Base } from "../base.component";
import { bannerStateFromRequest, sendComponent } from "@packages/web-shell";

import { extractReturnUrl, parseReturnUrl } from "./parse-return-url";
import { baseCookieOptions } from "@packages/web-analytics";
import { SESSION_COOKIE_NAME } from "@packages/web-session";
import { persistentSessionCookieOptions } from "./session-cookie-options";
import { LoginPage } from "./auth.component";
import { initFetchUserCount } from "./fetch-user-count";
import { readClickAttribution } from "@packages/web-analytics";
import { consumePendingSaveId } from "../pending-save";
import { consumeLastViewUrl } from "../last-view";
import { resolvePostSignupRedirect } from "./post-signup-redirect";
import type { ConversionEvent } from "../../conversions";
import { emitUserCreated } from "../../conversions";
import { signState, verifyState } from "./oauth-state";

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
	countUsers: CountUsers;
	markEmailVerified: MarkEmailVerified;
	exchangeGoogleCode: ExchangeGoogleCode;
	upsertTrialing: UpsertTrialingSubscription;
	trialScheduler: TrialSchedulerPort;
	sendEmail: SendEmail;
	logError: (message: string, error?: Error) => void;
	now: () => Date;
	conversionLogger: HutchLogger.Typed<ConversionEvent>;
	foundingAllocation: FoundingAllocation;
}

export const initGoogleAuthRoutes = (deps: GoogleAuthDependencies): Router => {
	const router = express.Router();
	const sessionCookieOptions = persistentSessionCookieOptions(deps.secureCookies);
	const redirectUri = `${deps.appOrigin}/auth/google/callback`;
	const fetchUserCount = initFetchUserCount({
		countUsers: deps.countUsers,
		logError: deps.logError,
		logPrefix: "[Google Auth]",
	});
	const sendWelcomeEmail = initSendWelcomeEmail({
		sendEmail: deps.sendEmail,
		baseUrl: deps.baseUrl,
		staticBaseUrl: deps.staticBaseUrl,
		logError: deps.logError,
	});

	router.get("/auth/google", (req: Request, res: Response) => {
		const returnUrl = extractReturnUrl(req.query);
		const nonce = randomBytes(16).toString("hex");
		const createdAt = Date.now();
		const statePayload = JSON.stringify({ nonce, returnUrl, createdAt });
		const signedState = signState({ payload: statePayload, secret: deps.googleClientSecret });

		res.cookie(STATE_COOKIE, signedState, {
			...baseCookieOptions(deps.secureCookies),
			maxAge: STATE_TTL_MS,
		});

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

		const renderError = async (message: string) => {
			const userCount = await fetchUserCount();
			sendComponent(
				req,
				res,
				Base(LoginPage(
					{ userCount, foundingAllocation: deps.foundingAllocation, errors: [{ message }] },
					{ statusCode: 400 },
				), bannerStateFromRequest(req)),
			);
		};

		if (!parsedQuery.success || !stateCookie || parsedQuery.data.state !== stateCookie) {
			await renderError("Google sign-in failed. Please try again.");
			return;
		}
		const { code, state: stateParam } = parsedQuery.data;

		const payload = verifyState({ signed: stateParam, secret: deps.googleClientSecret });
		if (!payload) {
			await renderError("Google sign-in failed. Please try again.");
			return;
		}

		const stateData = StatePayloadSchema.parse(JSON.parse(payload));
		if (Date.now() - stateData.createdAt > STATE_TTL_MS) {
			await renderError("Google sign-in expired. Please try again.");
			return;
		}

		let tokenResult: Awaited<ReturnType<ExchangeGoogleCode>>;
		try {
			tokenResult = await deps.exchangeGoogleCode(code);
		} catch (error) {
			deps.logError("[Google Auth] Token exchange failed", error instanceof Error ? error : new Error(String(error)));
			await renderError("Google sign-in failed. Please try again.");
			return;
		}

		if (!tokenResult.emailVerified) {
			await renderError("Your Google account email is not verified.");
			return;
		}

		const existing = await deps.findUserByEmail(tokenResult.email);
		if (existing) {
			if (!existing.emailVerified) {
				await deps.markEmailVerified(tokenResult.email);
			}
			const sessionId = await deps.createSession({ userId: existing.userId, emailVerified: true });
			res.cookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions);
			res.redirect(303, parseReturnUrl({ return: stateData.returnUrl }));
			return;
		}

		const newUserId = UserIdSchema.parse(randomBytes(16).toString("hex"));
		const safeReturnUrl = extractReturnUrl({ return: stateData.returnUrl });

		const userCount = await fetchUserCount();
		/* Read once, then persisted on the user row (durable) AND emitted on the
		 * user_created conversion event (30-day retention). */
		const attribution = readClickAttribution(req);
		if (!deps.foundingAllocation.isFoundingAllocationExhausted(userCount)) {
			const created = await deps.createGoogleUser({
				email: tokenResult.email,
				userId: newUserId,
				attribution,
			});
			if (!created.ok) {
				const lookup = await deps.findUserByEmail(tokenResult.email);
				if (lookup) {
					if (!lookup.emailVerified) {
						await deps.markEmailVerified(tokenResult.email);
					}
					const sessionId = await deps.createSession({ userId: lookup.userId, emailVerified: true });
					res.cookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions);
					res.redirect(303, parseReturnUrl({ return: safeReturnUrl }));
					return;
				}
				await renderError("Account creation failed. Please try again.");
				return;
			}

			const sessionId = await deps.createSession({ userId: created.userId, emailVerified: true });
			res.cookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions);
			sendWelcomeEmail(tokenResult.email);
			emitUserCreated(
				{ logger: deps.conversionLogger, now: deps.now },
				{
					userId: created.userId,
					email: tokenResult.email,
					method: "google",
					tier: "free",
					attribution,
					visitorId: req.visitorId,
					pendingSaveId: consumePendingSaveId({ req, res }),
				},
			);
			const lastViewUrl = consumeLastViewUrl({ req, res });
			res.redirect(303, resolvePostSignupRedirect({ returnUrl: safeReturnUrl, lastViewUrl }));
			return;
		}

		const created = await deps.createGoogleUser({
			email: tokenResult.email,
			userId: newUserId,
			attribution,
		});
		if (!created.ok) {
			const lookup = await deps.findUserByEmail(tokenResult.email);
			if (lookup) {
				if (!lookup.emailVerified) {
					await deps.markEmailVerified(tokenResult.email);
				}
				const sessionIdRace = await deps.createSession({ userId: lookup.userId, emailVerified: true });
				res.cookie(SESSION_COOKIE_NAME, sessionIdRace, sessionCookieOptions);
				res.redirect(303, parseReturnUrl({ return: safeReturnUrl }));
				return;
			}
			await renderError("Account creation failed. Please try again.");
			return;
		}

		await startTrial({
			mode: "signup",
			userId: created.userId,
			trialEndsAt: trialEndsAtFromNow(deps.now()),
			now: deps.now(),
			upsertTrialing: deps.upsertTrialing,
			trialScheduler: deps.trialScheduler,
			logError: deps.logError,
		});

		const sessionId = await deps.createSession({ userId: created.userId, emailVerified: true });
		res.cookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions);
		sendWelcomeEmail(tokenResult.email);
		emitUserCreated(
			{ logger: deps.conversionLogger, now: deps.now },
			{
				userId: created.userId,
				email: tokenResult.email,
				method: "google",
				tier: "trial",
				attribution: readClickAttribution(req),
				visitorId: req.visitorId,
				pendingSaveId: consumePendingSaveId({ req, res }),
			},
		);
		const lastViewUrl = consumeLastViewUrl({ req, res });
		res.redirect(303, resolvePostSignupRedirect({ returnUrl: safeReturnUrl, lastViewUrl }));
	});

	return router;
};
