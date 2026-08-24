import { randomBytes } from "node:crypto";
import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type {
	CountUsers,
	CreateAppleUser,
	CreateSession,
	FindUserByEmail,
	MarkEmailVerified,
	SaveAppleRefreshToken,
} from "@packages/provider-contracts/auth";
import type { SendEmail } from "@packages/provider-contracts/email";
import type { ExchangeAppleCode } from "@packages/provider-contracts/apple-auth";
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
import { oauthClientIdFrom } from "./oauth-client-id";
import { baseCookieOptions } from "@packages/web-analytics";
import type { AnalyticsEvent } from "@packages/web-analytics";
import { SESSION_COOKIE_NAME } from "@packages/web-session";
import { persistentSessionCookieOptions } from "./session-cookie-options";
import { LoginPage } from "./auth.component";
import { initFetchUserCount } from "./fetch-user-count";
import { ClickAttributionSchema, readClickAttribution } from "@packages/web-analytics";
import { PENDING_SAVE_COOKIE_NAME, readPendingSaveId } from "../pending-save";
import { LAST_VIEW_COOKIE_NAME, readLastViewUrl } from "../last-view";
import { readLastAuthProvider, setLastAuthProvider } from "../last-auth-provider";
import { resolvePostSignupRedirect } from "./post-signup-redirect";
import { emitFirstArticleAutosaved } from "./first-article-autosaved";
import type { ConversionEvent } from "../../conversions";
import { emitUserCreated } from "../../conversions";
import { readHomepageVariantSlug } from "../experiments/homepage-assignment";
import { verifyState } from "./oauth-state";
import { signAppleState } from "./apple-state";

const CallbackBodySchema = z.object({
	code: z.string().min(1),
	state: z.string().min(1),
});

const CancelBodySchema = z.object({
	error: z.literal("user_cancelled_authorize"),
});

/** Apple's cross-site form_post callback carries none of the first-party cookies
 * (hutch_click / hutch_vid / hutch_psid), so the acquisition context is captured
 * at GET /auth/apple and tunneled inside this HMAC-signed (tamper-evident) state
 * rather than re-read on the callback. */
const StatePayloadSchema = z.object({
	nonce: z.string(),
	returnUrl: z.string().optional(),
	createdAt: z.number(),
	attribution: ClickAttributionSchema.optional(),
	visitorId: z.string().optional(),
	homepageVariant: z.string().optional(),
	pendingSaveId: z.string().optional(),
	lastViewUrl: z.string().optional(),
});

const STATE_COOKIE = "hutch_astate";
const STATE_TTL_MS = 5 * 60 * 1000;

interface AppleAuthDependencies {
	appleClientId: string;
	stateSigningSecret: string;
	appOrigin: string;
	baseUrl: string;
	staticBaseUrl: string;
	secureCookies: boolean;
	createSession: CreateSession;
	createAppleUser: CreateAppleUser;
	saveAppleRefreshToken: SaveAppleRefreshToken;
	findUserByEmail: FindUserByEmail;
	countUsers: CountUsers;
	markEmailVerified: MarkEmailVerified;
	exchangeAppleCode: ExchangeAppleCode;
	upsertTrialing: UpsertTrialingSubscription;
	trialScheduler: TrialSchedulerPort;
	sendEmail: SendEmail;
	logError: (message: string, error?: Error) => void;
	now: () => Date;
	conversionLogger: HutchLogger.Typed<ConversionEvent>;
	analytics: HutchLogger.Typed<AnalyticsEvent>;
	salt: string;
	foundingAllocation: FoundingAllocation;
}

export const initAppleAuthRoutes = (deps: AppleAuthDependencies): Router => {
	const router = express.Router();
	const sessionCookieOptions = persistentSessionCookieOptions(deps.secureCookies);
	const signIn = (res: Response, sessionId: string): void => {
		res.cookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions);
		setLastAuthProvider({ res, secure: deps.secureCookies }, "apple");
	};
	// The state cookie must survive the cross-site form_post callback, where a
	// SameSite=Lax cookie would not be sent — so it is SameSite=None (implying
	// Secure). Clearing it later uses the matching sameSite/secure attributes.
	const stateCookieOptions = {
		...baseCookieOptions(deps.secureCookies),
		sameSite: "none" as const,
	};
	const redirectUri = `${deps.appOrigin}/auth/apple/callback`;
	const fetchUserCount = initFetchUserCount({
		countUsers: deps.countUsers,
		logError: deps.logError,
		logPrefix: "[Apple Auth]",
	});
	const sendWelcomeEmail = initSendWelcomeEmail({
		sendEmail: deps.sendEmail,
		baseUrl: deps.baseUrl,
		staticBaseUrl: deps.staticBaseUrl,
		logError: deps.logError,
	});

	router.get("/auth/apple", (req: Request, res: Response) => {
		const returnUrl = extractReturnUrl(req.query);
		const nonce = randomBytes(16).toString("hex");
		const createdAt = Date.now();
		/* Read (not consume) — an abandoned flow must leave the pending save
		 * intact for a later signup. */
		const attribution = readClickAttribution(req);
		const visitorId = req.visitorId;
		const homepageVariant = readHomepageVariantSlug(req);
		const pendingSaveId = readPendingSaveId(req);
		const lastViewUrl = readLastViewUrl(req);
		const signedState = signAppleState({
			payload: {
				nonce,
				returnUrl,
				createdAt,
				...(attribution ? { attribution } : {}),
				...(visitorId ? { visitorId } : {}),
				...(homepageVariant ? { homepageVariant } : {}),
				...(pendingSaveId ? { pendingSaveId } : {}),
			},
			lastViewUrl,
			secret: deps.stateSigningSecret,
		});

		res.cookie(STATE_COOKIE, signedState, {
			...stateCookieOptions,
			maxAge: STATE_TTL_MS,
		});

		const params = new URLSearchParams({
			client_id: deps.appleClientId,
			redirect_uri: redirectUri,
			response_type: "code",
			scope: "email",
			response_mode: "form_post",
			state: signedState,
		});

		res.redirect(303, `https://appleid.apple.com/auth/authorize?${params.toString()}`);
	});

	router.post("/auth/apple/callback", async (req: Request, res: Response) => {
		res.clearCookie(STATE_COOKIE, { path: "/", sameSite: "none", secure: deps.secureCookies });

		/* User backed out of Apple's consent screen. Under form_post this posts
		 * error=user_cancelled_authorize (with state, no code) straight to us, so
		 * return quietly to /login — a deliberate cancel is not an error and a 400
		 * would only pollute monitoring. */
		if (CancelBodySchema.safeParse(req.body).success) {
			res.redirect(303, "/login");
			return;
		}

		const parsedBody = CallbackBodySchema.safeParse(req.body);
		const stateCookie = req.cookies?.[STATE_COOKIE];

		const renderError = async (message: string) => {
			const userCount = await fetchUserCount();
			sendComponent(
				req,
				res,
				Base(LoginPage(
					{
						userCount,
						foundingAllocation: deps.foundingAllocation,
						lastUsedProvider: readLastAuthProvider(req),
						errors: [{ message }],
					},
					{ statusCode: 400 },
				), bannerStateFromRequest(req)),
			);
		};

		if (!parsedBody.success || !stateCookie || parsedBody.data.state !== stateCookie) {
			await renderError("Apple sign-in failed. Please try again.");
			return;
		}
		const { code, state: stateParam } = parsedBody.data;

		const payload = verifyState({ signed: stateParam, secret: deps.stateSigningSecret });
		if (!payload) {
			await renderError("Apple sign-in failed. Please try again.");
			return;
		}

		const stateData = StatePayloadSchema.parse(JSON.parse(payload));
		if (Date.now() - stateData.createdAt > STATE_TTL_MS) {
			await renderError("Apple sign-in expired. Please try again.");
			return;
		}

		let tokenResult: Awaited<ReturnType<ExchangeAppleCode>>;
		try {
			tokenResult = await deps.exchangeAppleCode(code);
		} catch (error) {
			deps.logError("[Apple Auth] Token exchange failed", error instanceof Error ? error : new Error(String(error)));
			await renderError("Apple sign-in failed. Please try again.");
			return;
		}

		if (!tokenResult.emailVerified) {
			await renderError("Your Apple account email is not verified.");
			return;
		}

		const existing = await deps.findUserByEmail(tokenResult.email);
		if (existing) {
			/* Every code exchange mints a fresh grant, and a returning user may
			 * predate token persistence — store it on login too, or account
			 * deletion could not revoke their Sign in with Apple grant. */
			await deps.saveAppleRefreshToken({
				email: tokenResult.email,
				appleRefreshToken: tokenResult.appleRefreshToken,
			});
			if (!existing.emailVerified) {
				await deps.markEmailVerified(tokenResult.email);
			}
			const sessionId = await deps.createSession({ userId: existing.userId, emailVerified: true });
			signIn(res, sessionId);
			res.redirect(303, parseReturnUrl({ return: stateData.returnUrl }));
			return;
		}

		const newUserId = UserIdSchema.parse(randomBytes(16).toString("hex"));
		const safeReturnUrl = extractReturnUrl({ return: stateData.returnUrl });

		/* Tunneled from GET /auth/apple — the cross-site callback carries none of
		 * the cookies these came from, so reading them off `req` here would record
		 * an orphan visitor id and lose attribution on every real Apple signup. */
		const attribution = stateData.attribution;
		const conversionContext = {
			attribution,
			visitorId: stateData.visitorId,
			homepageVariant: stateData.homepageVariant,
			pendingSaveId: stateData.pendingSaveId,
			oauthClientId: oauthClientIdFrom(safeReturnUrl),
		};
		/* hutch_psid is same-site so it is not sent on this cross-site POST, but
		 * the response Set-Cookie still applies to readplace.com — clear it so the
		 * consumed save cannot re-attach to a later signup. */
		const clearPendingSave = () => res.clearCookie(PENDING_SAVE_COOKIE_NAME, { path: "/" });
		/* Same rationale as clearPendingSave: hutch_lastview is same-site Lax so it
		 * is not sent on this cross-site POST, but the response Set-Cookie still
		 * applies to readplace.com — clear it so the tunneled URL cannot auto-save
		 * onto a later signup. */
		const clearLastView = () => res.clearCookie(LAST_VIEW_COOKIE_NAME, { path: "/" });

		const userCount = await fetchUserCount();
		if (!deps.foundingAllocation.isFoundingAllocationExhausted(userCount)) {
			const created = await deps.createAppleUser({
				email: tokenResult.email,
				userId: newUserId,
				appleRefreshToken: tokenResult.appleRefreshToken,
				attribution,
			});
			if (!created.ok) {
				const lookup = await deps.findUserByEmail(tokenResult.email);
				if (lookup) {
					await deps.saveAppleRefreshToken({
						email: tokenResult.email,
						appleRefreshToken: tokenResult.appleRefreshToken,
					});
					if (!lookup.emailVerified) {
						await deps.markEmailVerified(tokenResult.email);
					}
					const sessionId = await deps.createSession({ userId: lookup.userId, emailVerified: true });
					signIn(res, sessionId);
					res.redirect(303, parseReturnUrl({ return: safeReturnUrl }));
					return;
				}
				await renderError("Account creation failed. Please try again.");
				return;
			}

			const sessionId = await deps.createSession({ userId: created.userId, emailVerified: true });
			signIn(res, sessionId);
			clearPendingSave();
			clearLastView();
			sendWelcomeEmail(tokenResult.email);
			emitUserCreated(
				{ logger: deps.conversionLogger, now: deps.now },
				{
					userId: created.userId,
					email: tokenResult.email,
					method: "apple",
					tier: "free",
					...conversionContext,
				},
			);
			const redirect = resolvePostSignupRedirect({ returnUrl: safeReturnUrl, lastViewUrl: stateData.lastViewUrl });
			emitFirstArticleAutosaved(
				{ logger: deps.analytics, now: deps.now, salt: deps.salt },
				{ autosavedUrl: redirect.autosavedUrl, userId: created.userId, visitorId: stateData.visitorId, ip: req.ip },
			);
			res.redirect(303, redirect.location);
			return;
		}

		const created = await deps.createAppleUser({
			email: tokenResult.email,
			userId: newUserId,
			appleRefreshToken: tokenResult.appleRefreshToken,
			attribution,
		});
		if (!created.ok) {
			const lookup = await deps.findUserByEmail(tokenResult.email);
			if (lookup) {
				await deps.saveAppleRefreshToken({
					email: tokenResult.email,
					appleRefreshToken: tokenResult.appleRefreshToken,
				});
				if (!lookup.emailVerified) {
					await deps.markEmailVerified(tokenResult.email);
				}
				const sessionIdRace = await deps.createSession({ userId: lookup.userId, emailVerified: true });
				signIn(res, sessionIdRace);
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
		signIn(res, sessionId);
		clearPendingSave();
		clearLastView();
		sendWelcomeEmail(tokenResult.email);
		emitUserCreated(
			{ logger: deps.conversionLogger, now: deps.now },
			{
				userId: created.userId,
				email: tokenResult.email,
				method: "apple",
				tier: "trial",
				...conversionContext,
			},
		);
		const redirect = resolvePostSignupRedirect({ returnUrl: safeReturnUrl, lastViewUrl: stateData.lastViewUrl });
		emitFirstArticleAutosaved(
			{ logger: deps.analytics, now: deps.now, salt: deps.salt },
			{ autosavedUrl: redirect.autosavedUrl, userId: created.userId, visitorId: stateData.visitorId, ip: req.ip },
		);
		res.redirect(303, redirect.location);
	});

	return router;
};
