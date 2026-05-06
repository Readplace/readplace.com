import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import type {
	CountUsers,
	CreateGoogleUser,
	CreateSession,
	CreateUserWithPasswordHash,
	DestroySession,
	FindUserByEmail,
	MarkEmailVerified,
	MarkSessionEmailVerified,
	VerifyCredentials,
} from "@packages/test-fixtures/providers/auth";
import { hashPassword } from "@packages/test-fixtures/providers/auth";
import type { UserId } from "@packages/domain/user";
import type { SendEmail } from "@packages/test-fixtures/providers/email";
import type {
	CreateVerificationToken,
	VerifyEmailToken,
} from "@packages/test-fixtures/providers/email-verification";
import { VerificationTokenSchema } from "@packages/test-fixtures/providers/email-verification";
import type {
	ConsumePendingSignup,
	StorePendingSignup,
} from "@packages/test-fixtures/providers/pending-signup";
import { CheckoutSessionIdSchema } from "@packages/test-fixtures/providers/stripe-checkout";
import type {
	CreateCheckoutSession,
	RetrieveCheckoutSession,
} from "@packages/test-fixtures/providers/stripe-checkout";
import { renderPage } from "../render-page";
import { sendComponent } from "../send-component";
import { LoginSchema, SignupSchema } from "./auth.schema";
import { LoginPage, SignupPage, VerifyEmailPage } from "./auth.component";
import { extractReturnUrl, parseReturnUrl } from "./parse-return-url";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "./session-cookie";
import { buildVerificationEmailHtml } from "./verification-email";
import { flattenZodErrors } from "./flatten-zod-errors";
import { initFetchUserCount } from "./fetch-user-count";
import { initSendWelcomeEmail } from "./send-welcome-email";
import { isFoundingAllocationExhausted } from "../shared/founding-progress/founding-allocation";

const TokenQuerySchema = z.object({ token: z.string().optional() }).passthrough();
const CheckoutSuccessQuerySchema = z.object({ session_id: z.string().min(1) }).passthrough();
const SignupQuerySchema = z.object({ email: z.string().email() }).passthrough();

const EMAIL_FROM = "Fayner Brack <readplace@readplace.com>";

const SIGNUP_MIN_SUBMIT_MS = 2500;

import type { BotDefenseEvent, BotDefenseRejectReason } from "@packages/test-fixtures/providers/auth";
export type { BotDefenseEvent, BotDefenseRejectReason };

interface AuthDependencies {
	createUserWithPasswordHash: CreateUserWithPasswordHash;
	createGoogleUser: CreateGoogleUser;
	findUserByEmail: FindUserByEmail;
	verifyCredentials: VerifyCredentials;
	createSession: CreateSession;
	destroySession: DestroySession;
	countUsers: CountUsers;
	markEmailVerified: MarkEmailVerified;
	markSessionEmailVerified: MarkSessionEmailVerified;
	sendEmail: SendEmail;
	createVerificationToken: CreateVerificationToken;
	verifyEmailToken: VerifyEmailToken;
	createCheckoutSession: CreateCheckoutSession;
	retrieveCheckoutSession: RetrieveCheckoutSession;
	storePendingSignup: StorePendingSignup;
	consumePendingSignup: ConsumePendingSignup;
	appOrigin: string;
	baseUrl: string;
	staticBaseUrl: string;
	logError: (message: string, error?: Error) => void;
	now: () => Date;
	botDefenseLogger: HutchLogger.Typed<BotDefenseEvent>;
}

type BotDefenseResult =
	| { trip: false }
	| { trip: true; reason: BotDefenseRejectReason; timeToSubmitMs?: number };

function checkSignupBotDefense(
	body: Record<string, unknown>,
	nowMs: number,
): BotDefenseResult {
	const website = body.website;
	if (typeof website === "string" && website.length > 0) {
		return { trip: true, reason: "honeypot" };
	}

	const rawLoadedAt = body.loadedAt;
	if (typeof rawLoadedAt !== "string" || rawLoadedAt.length === 0) {
		return { trip: true, reason: "missing_timestamp" };
	}

	const loadedAt = Number.parseInt(rawLoadedAt, 10);
	if (!Number.isFinite(loadedAt) || String(loadedAt) !== rawLoadedAt) {
		return { trip: true, reason: "invalid_timestamp" };
	}

	const elapsed = nowMs - loadedAt;
	if (elapsed < SIGNUP_MIN_SUBMIT_MS) {
		return { trip: true, reason: "submit_too_fast", timeToSubmitMs: elapsed };
	}

	return { trip: false };
}

function extractEmailDomain(body: Record<string, unknown>): string | undefined {
	const email = body.email;
	if (typeof email !== "string") return undefined;
	const at = email.indexOf("@");
	if (at === -1) return undefined;
	const domain = email.slice(at + 1).toLowerCase();
	return domain.length > 0 ? domain : undefined;
}

export function initAuthRoutes(deps: AuthDependencies): Router {
	const router = express.Router();

	const fetchUserCount = initFetchUserCount({
		countUsers: deps.countUsers,
		logError: deps.logError,
		logPrefix: "[Auth]",
	});

	const buildSuccessUrl = (returnUrl: string | undefined): string => {
		/** Stripe substitutes {CHECKOUT_SESSION_ID} server-side, so the URL must
		 * contain the literal placeholder — we cannot URL-encode the braces. */
		const returnSuffix = returnUrl ? `&return=${encodeURIComponent(returnUrl)}` : "";
		return `${deps.appOrigin}/auth/checkout/success?session_id={CHECKOUT_SESSION_ID}${returnSuffix}`;
	};

	const buildCancelUrl = (path: "/signup", returnUrl: string | undefined): string => {
		const suffix = returnUrl ? `?return=${encodeURIComponent(returnUrl)}` : "";
		return `${deps.appOrigin}${path}${suffix}`;
	};

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
		sendComponent(res, renderPage(req, LoginPage({ returnUrl, userCount })));
	});

	router.post("/login", async (req: Request, res: Response) => {
		const returnUrl = extractReturnUrl(req.query);
		const parsed = LoginSchema.safeParse(req.body);

		if (!parsed.success) {
			const userCount = await fetchUserCount();
			sendComponent(
				res,
				renderPage(req, LoginPage(
					{
						returnUrl,
						userCount,
						email: req.body?.email,
						errors: flattenZodErrors(parsed.error.issues),
					},
					{ statusCode: 422 },
				)),
			);
			return;
		}

		const { email, password } = parsed.data;
		const credentials = await deps.verifyCredentials({ email, password });

		if (!credentials.ok) {
			const userCount = await fetchUserCount();
			sendComponent(
				res,
				renderPage(req, LoginPage(
					{
						returnUrl,
						userCount,
						email,
						globalError: "Invalid email or password",
					},
					{ statusCode: 422 },
				)),
			);
			return;
		}

		const sessionId = await deps.createSession({ userId: credentials.userId, emailVerified: credentials.emailVerified });
		res.cookie(SESSION_COOKIE_NAME, sessionId, SESSION_COOKIE_OPTIONS);
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
		sendComponent(
			res,
			renderPage(
				req,
				SignupPage({ returnUrl, userCount, loadedAt: deps.now().getTime(), email }),
			),
		);
	});

	router.post("/signup", async (req: Request, res: Response) => {
		const returnUrl = extractReturnUrl(req.query);
		const body = (req.body ?? {}) as Record<string, unknown>;

		const botCheck = checkSignupBotDefense(body, deps.now().getTime());
		if (botCheck.trip) {
			const event: BotDefenseEvent = {
				stream: "bot-defense",
				event: "signup_rejected",
				reason: botCheck.reason,
				timestamp: deps.now().toISOString(),
			};
			if (req.ip) event.ip = req.ip;
			const emailDomain = extractEmailDomain(body);
			if (emailDomain) event.email_domain = emailDomain;
			if (botCheck.timeToSubmitMs !== undefined) {
				event.time_to_submit_ms = botCheck.timeToSubmitMs;
			}
			deps.botDefenseLogger.info(event);
			res.redirect(303, "/?signup=pending");
			return;
		}

		const parsed = SignupSchema.safeParse(req.body);

		if (!parsed.success) {
			const userCount = await fetchUserCount();
			sendComponent(
				res,
				renderPage(req, SignupPage(
					{
						returnUrl,
						userCount,
						loadedAt: deps.now().getTime(),
						email: req.body?.email,
						errors: flattenZodErrors(parsed.error.issues),
					},
					{ statusCode: 422 },
				)),
			);
			return;
		}

		const { email, password } = parsed.data;

		const existing = await deps.findUserByEmail(email);
		if (existing) {
			const userCount = await fetchUserCount();
			sendComponent(
				res,
				renderPage(req, SignupPage(
					{
						returnUrl,
						userCount,
						loadedAt: deps.now().getTime(),
						email,
						globalError: "An account with this email already exists",
					},
					{ statusCode: 422 },
				)),
			);
			return;
		}

		const passwordHash = await hashPassword(password);

		const userCount = await fetchUserCount();
		if (!isFoundingAllocationExhausted(userCount)) {
			const created = await deps.createUserWithPasswordHash({ email, passwordHash });
			if (!created.ok) {
				const refreshedCount = await fetchUserCount();
				sendComponent(
					res,
					renderPage(req, SignupPage(
						{
							returnUrl,
							userCount: refreshedCount,
							loadedAt: deps.now().getTime(),
							email,
							globalError: "An account with this email already exists",
						},
						{ statusCode: 422 },
					)),
				);
				return;
			}

			const sessionId = await deps.createSession({ userId: created.userId, emailVerified: false });
			res.cookie(SESSION_COOKIE_NAME, sessionId, SESSION_COOKIE_OPTIONS);
			sendVerificationEmail(created.userId, email);
			res.redirect(303, parseReturnUrl({ return: returnUrl }));
			return;
		}

		const checkout = await deps.createCheckoutSession({
			customerEmail: email,
			successUrl: buildSuccessUrl(returnUrl),
			cancelUrl: buildCancelUrl("/signup", returnUrl),
		});

		await deps.storePendingSignup({
			checkoutSessionId: checkout.id,
			signup: {
				method: "email",
				email,
				passwordHash,
				...(returnUrl ? { returnUrl } : {}),
			},
		});

		res.redirect(303, checkout.url);
	});

	router.get("/auth/checkout/success", async (req: Request, res: Response) => {
		const parsedQuery = CheckoutSuccessQuerySchema.safeParse(req.query);
		if (!parsedQuery.success) {
			const userCount = await fetchUserCount();
			sendComponent(
				res,
				renderPage(req, SignupPage(
					{
						userCount,
						loadedAt: deps.now().getTime(),
						globalError: "Missing checkout session — please start again.",
					},
					{ statusCode: 400 },
				)),
			);
			return;
		}

		const checkoutSessionId = CheckoutSessionIdSchema.parse(parsedQuery.data.session_id);
		const session = await deps.retrieveCheckoutSession(checkoutSessionId);

		const renderFailure = async (statusCode: number, globalError: string) => {
			const userCount = await fetchUserCount();
			sendComponent(
				res,
				renderPage(
					req,
					SignupPage(
						{ userCount, loadedAt: deps.now().getTime(), globalError },
						{ statusCode },
					),
				),
			);
		};

		if (!session.ok) {
			await renderFailure(404, "Checkout session not found — please start again.");
			return;
		}

		if (!session.paid) {
			await renderFailure(402, "Payment was not completed. Please try again.");
			return;
		}

		const pending = await deps.consumePendingSignup(checkoutSessionId);
		if (!pending) {
			await renderFailure(409, "This checkout link has already been used.");
			return;
		}

		const returnPath = parseReturnUrl({ return: pending.returnUrl });

		if (pending.method === "email") {
			const created = await deps.createUserWithPasswordHash({
				email: pending.email,
				passwordHash: pending.passwordHash,
			});
			if (!created.ok) {
				await renderFailure(409, "An account with this email already exists. Please sign in.");
				return;
			}

			const sessionId = await deps.createSession({ userId: created.userId, emailVerified: false });
			res.cookie(SESSION_COOKIE_NAME, sessionId, SESSION_COOKIE_OPTIONS);
			sendVerificationEmail(created.userId, pending.email);
			res.redirect(303, returnPath);
			return;
		}

		const created = await deps.createGoogleUser({
			email: pending.email,
			userId: pending.userId,
		});
		if (!created.ok) {
			const lookup = await deps.findUserByEmail(pending.email);
			if (!lookup) {
				await renderFailure(500, "Account creation failed. Please contact support.");
				return;
			}
			if (!lookup.emailVerified) {
				await deps.markEmailVerified(pending.email);
			}
			const sessionId = await deps.createSession({ userId: lookup.userId, emailVerified: true });
			res.cookie(SESSION_COOKIE_NAME, sessionId, SESSION_COOKIE_OPTIONS);
			res.redirect(303, returnPath);
			return;
		}

		const sessionId = await deps.createSession({ userId: created.userId, emailVerified: true });
		res.cookie(SESSION_COOKIE_NAME, sessionId, SESSION_COOKIE_OPTIONS);
		sendWelcomeEmail(pending.email);
		res.redirect(303, returnPath);
	});

	router.get("/verify-email", async (req: Request, res: Response) => {
		const parsed = TokenQuerySchema.safeParse(req.query);
		const token = parsed.success ? (parsed.data.token ?? "") : "";

		if (!token) {
			sendComponent(
				res,
				renderPage(req, VerifyEmailPage({
					success: false,
					error: "No verification token provided.",
				})),
			);
			return;
		}

		const verifyResult = await deps.verifyEmailToken(VerificationTokenSchema.parse(token));

		if (!verifyResult.ok) {
			sendComponent(
				res,
				renderPage(req, VerifyEmailPage({
					success: false,
					error: "This verification link is invalid or has already been used.",
				})),
			);
			return;
		}

		await deps.markEmailVerified(verifyResult.email);
		sendWelcomeEmail(verifyResult.email);

		const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
		if (sessionId) {
			await deps.markSessionEmailVerified(sessionId);
		}

		sendComponent(res, renderPage(req, VerifyEmailPage({ success: true })));
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
