import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import type {
	CountUsers,
	CreateGoogleUser,
	CreateSession,
	FindUserByEmail,
	MarkEmailVerified,
} from "@packages/test-fixtures/providers/auth";
import type { SendEmail } from "@packages/test-fixtures/providers/email";
import type { ExchangeGoogleCode } from "@packages/test-fixtures/providers/google-auth";
import type { StorePendingSignup } from "@packages/test-fixtures/providers/pending-signup";
import type { CreateCheckoutSession } from "@packages/test-fixtures/providers/stripe-checkout";
import { isFoundingAllocationExhausted } from "../shared/founding-progress/founding-allocation";
import { initSendWelcomeEmail } from "./send-welcome-email";
import { renderPage } from "../render-page";
import { sendComponent } from "../send-component";
import { extractReturnUrl, parseReturnUrl } from "./parse-return-url";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "./session-cookie";
import { LoginPage } from "./auth.component";
import { initFetchUserCount } from "./fetch-user-count";

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
	createSession: CreateSession;
	createGoogleUser: CreateGoogleUser;
	findUserByEmail: FindUserByEmail;
	countUsers: CountUsers;
	markEmailVerified: MarkEmailVerified;
	exchangeGoogleCode: ExchangeGoogleCode;
	createCheckoutSession: CreateCheckoutSession;
	storePendingSignup: StorePendingSignup;
	sendEmail: SendEmail;
	logError: (message: string, error?: Error) => void;
}

const signState = (payload: string, secret: string): string => {
	const mac = createHmac("sha256", secret).update(payload).digest("base64url");
	return `${payload}.${mac}`;
};

const verifyState = (signed: string, secret: string): string | null => {
	const dotIndex = signed.lastIndexOf(".");
	if (dotIndex === -1) return null;
	const payload = signed.slice(0, dotIndex);
	const expected = signState(payload, secret);
	if (signed.length !== expected.length) return null;
	const isValid = timingSafeEqual(Buffer.from(signed), Buffer.from(expected));
	if (!isValid) return null;
	return payload;
};

export const initGoogleAuthRoutes = (deps: GoogleAuthDependencies): Router => {
	const router = express.Router();
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
		const signedState = signState(statePayload, deps.googleClientSecret);

		res.cookie(STATE_COOKIE, signedState, {
			...SESSION_COOKIE_OPTIONS,
			maxAge: STATE_TTL_MS,
		});

		const params = new URLSearchParams({
			client_id: deps.googleClientId,
			redirect_uri: redirectUri,
			response_type: "code",
			scope: "openid email",
			state: signedState,
		});

		res.redirect(303, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
	});

	router.get("/auth/google/callback", async (req: Request, res: Response) => {
		const parsedQuery = CallbackQuerySchema.safeParse(req.query);
		const stateCookie = req.cookies?.[STATE_COOKIE];

		res.clearCookie(STATE_COOKIE, { path: "/" });

		const renderError = async (globalError: string) => {
			const userCount = await fetchUserCount();
			sendComponent(req, res, renderPage(req, LoginPage({ userCount, globalError }, { statusCode: 400 })));
		};

		if (!parsedQuery.success || !stateCookie || parsedQuery.data.state !== stateCookie) {
			await renderError("Google sign-in failed. Please try again.");
			return;
		}
		const { code, state: stateParam } = parsedQuery.data;

		const payload = verifyState(stateParam, deps.googleClientSecret);
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
			res.cookie(SESSION_COOKIE_NAME, sessionId, SESSION_COOKIE_OPTIONS);
			res.redirect(303, parseReturnUrl({ return: stateData.returnUrl }));
			return;
		}

		const newUserId = UserIdSchema.parse(randomBytes(16).toString("hex"));
		const safeReturnUrl = extractReturnUrl({ return: stateData.returnUrl });

		const userCount = await fetchUserCount();
		if (!isFoundingAllocationExhausted(userCount)) {
			const created = await deps.createGoogleUser({
				email: tokenResult.email,
				userId: newUserId,
			});
			if (!created.ok) {
				const lookup = await deps.findUserByEmail(tokenResult.email);
				if (lookup) {
					if (!lookup.emailVerified) {
						await deps.markEmailVerified(tokenResult.email);
					}
					const sessionId = await deps.createSession({ userId: lookup.userId, emailVerified: true });
					res.cookie(SESSION_COOKIE_NAME, sessionId, SESSION_COOKIE_OPTIONS);
					res.redirect(303, parseReturnUrl({ return: safeReturnUrl }));
					return;
				}
				await renderError("Account creation failed. Please try again.");
				return;
			}

			const sessionId = await deps.createSession({ userId: created.userId, emailVerified: true });
			res.cookie(SESSION_COOKIE_NAME, sessionId, SESSION_COOKIE_OPTIONS);
			sendWelcomeEmail(tokenResult.email);
			res.redirect(303, parseReturnUrl({ return: safeReturnUrl }));
			return;
		}

		const returnSuffix = safeReturnUrl
			? `&return=${encodeURIComponent(safeReturnUrl)}`
			: "";
		const successUrl = `${deps.appOrigin}/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}${returnSuffix}`;
		const cancelUrl = `${deps.appOrigin}/login`;

		const checkout = await deps.createCheckoutSession({
			customerEmail: tokenResult.email,
			successUrl,
			cancelUrl,
		});

		await deps.storePendingSignup({
			checkoutSessionId: checkout.id,
			signup: {
				method: "google",
				email: tokenResult.email,
				userId: newUserId,
				...(safeReturnUrl ? { returnUrl: safeReturnUrl } : {}),
			},
		});

		res.redirect(303, checkout.url);
	});

	return router;
};
