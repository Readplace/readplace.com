import assert from "node:assert";
import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type { RateLimitRule } from "@packages/domain/rate-limit";
import type { UserId } from "@packages/domain/user";
import type {
	CreateSession,
	DestroyUserSessions,
	FindSessionOAuthGrant,
	FindUserById,
	FindUserPasswordStatus,
	UpdatePassword,
	VerifyCredentials,
} from "@packages/provider-contracts/auth";
import type { RevokeOtherUserOAuthGrants } from "@packages/provider-contracts/oauth";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";
import { SESSION_COOKIE_NAME } from "@packages/web-session";
import { requireCspNonce, sendComponent, withInternalTracking } from "@packages/web-shell";
import { ChangePasswordPage, renderChangePasswordForm } from "../../auth/auth.component";
import {
	CONFIRM_PASSWORD_MISSING_MESSAGE,
	CURRENT_PASSWORD_MISSING_MESSAGE,
	ChangePasswordSchema,
	PASSWORDS_MISMATCH_MESSAGE,
	PASSWORD_TOO_SHORT_MESSAGE,
} from "../../auth/auth.schema";
import { flattenZodErrors } from "../../auth/flatten-zod-errors";
import { persistentSessionCookieOptions } from "../../auth/session-cookie-options";
import { type VerifyAccountPasswordResult, initVerifyAccountPassword } from "../../auth/sign-in-with-password";
import type { BuildBannerState } from "../../banner-state";
import { Base, ChromelessPage } from "../../base.component";
import { hxLocationToMain } from "../../hx-location";
import { HxRedirectPage } from "../../hx-redirect-page";
import { type NativeClientPlatform, isAppShell, nativeSurfaceOf } from "../../onboarding/native-client";
import type { ComponentError } from "../../shared/component-error.types";
import {
	CHANGE_PASSWORD_REFUSALS,
	type ChangePasswordRefusal,
	buildAccountPasswordUrl,
	buildAccountUrl,
} from "./account.url";
import { accountPageScripts } from "./account.component";

const ACCOUNT_PASSWORD_SOURCE = "account-password";
const CHANGE_PASSWORD_CARD_SELECTOR = "#change-password-card";
const LOGIN_URL = "/login";

const ChangePasswordRefusalSchema = z.enum(CHANGE_PASSWORD_REFUSALS);

const REFUSAL_ERRORS: Record<ChangePasswordRefusal, ComponentError> = {
	"current-missing": { fieldName: "currentPassword", message: CURRENT_PASSWORD_MISSING_MESSAGE },
	"current-incorrect": { fieldName: "currentPassword", message: "Current password is incorrect" },
	"too-many-attempts": { fieldName: "currentPassword", message: "Too many attempts — try again later" },
	"password-short": { fieldName: "password", message: PASSWORD_TOO_SHORT_MESSAGE },
	"confirm-missing": { fieldName: "confirmPassword", message: CONFIRM_PASSWORD_MISSING_MESSAGE },
	mismatch: { fieldName: "confirmPassword", message: PASSWORDS_MISMATCH_MESSAGE },
};

const VERIFY_REFUSALS: Record<Exclude<VerifyAccountPasswordResult, { ok: true }>["reason"], ChangePasswordRefusal> = {
	"invalid-credentials": "current-incorrect",
	"rate-limited": "too-many-attempts",
};

interface SurfaceMarkers {
	surfacePlatform: NativeClientPlatform | undefined;
	appShell: boolean;
}

type ChangePasswordOutcome = { landing: string } | { refusal: ChangePasswordRefusal; errors: ComponentError[] };

function markersOf(req: Request): SurfaceMarkers {
	return { surfacePlatform: nativeSurfaceOf(req), appShell: isAppShell(req) };
}

function formActionFor(markers: SurfaceMarkers): string {
	return withInternalTracking(buildAccountPasswordUrl(markers), {
		source: ACCOUNT_PASSWORD_SOURCE,
		content: "change-password",
	});
}

function submittedText(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function refusalNaming(error: ComponentError): ChangePasswordRefusal {
	const refusal = CHANGE_PASSWORD_REFUSALS.find(
		(code) => REFUSAL_ERRORS[code].fieldName === error.fieldName && REFUSAL_ERRORS[code].message === error.message,
	);
	assert(refusal, `no change-password refusal names ${error.fieldName}: ${error.message}`);
	return refusal;
}

function refuse(refusal: ChangePasswordRefusal): ChangePasswordOutcome {
	return { refusal, errors: [REFUSAL_ERRORS[refusal]] };
}

function answerChangePassword(
	req: Request,
	res: Response,
	answer: { outcome: ChangePasswordOutcome; email: string; markers: SurfaceMarkers },
): void {
	const { outcome, markers } = answer;
	if (req.get("HX-Request") !== "true") {
		res.redirect(
			303,
			"landing" in outcome ? outcome.landing : buildAccountPasswordUrl({ ...markers, error: outcome.refusal }),
		);
		return;
	}
	if (!("landing" in outcome)) {
		res
			.status(422)
			.type("html")
			.send(renderChangePasswordForm({ email: answer.email, formAction: formActionFor(markers), errors: outcome.errors }));
		return;
	}
	res.set("HX-Location", hxLocationToMain({ path: outcome.landing, source: CHANGE_PASSWORD_CARD_SELECTOR, scroll: "top" }));
	res.status(204).end();
}

export function initAccountPasswordRoutes(deps: {
	findUserById: FindUserById;
	findUserPasswordStatus: FindUserPasswordStatus;
	verifyCredentials: VerifyCredentials;
	consumeRateLimit: ConsumeRateLimit;
	loginAccountRule: RateLimitRule;
	updatePassword: UpdatePassword;
	destroyUserSessions: DestroyUserSessions;
	findSessionOAuthGrant: FindSessionOAuthGrant;
	revokeOtherUserOAuthGrants: RevokeOtherUserOAuthGrants;
	createSession: CreateSession;
	secureCookies: boolean;
	now: () => Date;
	buildBannerState: BuildBannerState;
}): Router {
	const router = express.Router();
	const verifyAccountPassword = initVerifyAccountPassword({
		consumeRateLimit: deps.consumeRateLimit,
		loginAccountRule: deps.loginAccountRule,
		verifyCredentials: deps.verifyCredentials,
	});

	async function loadAccount(userId: UserId) {
		const [user, status] = await Promise.all([deps.findUserById(userId), deps.findUserPasswordStatus(userId)]);
		assert(user, "a signed-in reader changing their password must resolve a user");
		assert(status, "a signed-in reader changing their password must resolve a password status");
		return { user, status };
	}

	router.use((req: Request, res: Response, next) => {
		if (req.userId) {
			next();
			return;
		}
		if (req.get("HX-Request") === "true") {
			sendComponent(req, res, HxRedirectPage(LOGIN_URL));
			return;
		}
		res.redirect(303, LOGIN_URL);
	});

	router.get("/", async (req: Request, res: Response) => {
		assert(req.userId, "the change-password guard admits only a signed-in reader");
		const { user, status } = await loadAccount(req.userId);
		const markers = markersOf(req);
		if (status.kind === "not-set") {
			res.redirect(303, buildAccountUrl(markers));
			return;
		}
		const refusal = ChangePasswordRefusalSchema.safeParse(req.query.error);
		const page = ChangePasswordPage({
			email: user.email,
			formAction: formActionFor(markers),
			forgotHref: withInternalTracking("/forgot-password", {
				source: ACCOUNT_PASSWORD_SOURCE,
				content: "forgot-password",
			}),
			backHref: withInternalTracking(buildAccountUrl(markers), {
				source: ACCOUNT_PASSWORD_SOURCE,
				content: "back-to-account",
			}),
			errors: refusal.success ? [REFUSAL_ERRORS[refusal.data]] : undefined,
			scripts: accountPageScripts(markers),
		});
		if (markers.appShell) {
			sendComponent(
				req,
				res,
				ChromelessPage(page, { cspNonce: requireCspNonce(req), appearance: user.appearance ?? "system" }),
			);
			return;
		}
		sendComponent(req, res, Base(page, await deps.buildBannerState(req, { preFetchedUser: user })));
	});

	router.post("/", async (req: Request, res: Response) => {
		assert(req.userId, "the change-password guard admits only a signed-in reader");
		const presented = req.cookies?.[SESSION_COOKIE_NAME];
		assert(presented, "a signed-in reader reaches the change-password form on a session cookie");
		const { user, status } = await loadAccount(req.userId);
		const markers = markersOf(req);
		const answer = (outcome: ChangePasswordOutcome) =>
			answerChangePassword(req, res, { outcome, email: user.email, markers });
		if (status.kind === "not-set") {
			answer({ landing: buildAccountUrl(markers) });
			return;
		}
		const parsed = ChangePasswordSchema.safeParse({
			currentPassword: submittedText(req.body?.currentPassword),
			password: submittedText(req.body?.password),
			confirmPassword: submittedText(req.body?.confirmPassword),
		});
		if (!parsed.success) {
			const errors = flattenZodErrors(parsed.error.issues);
			const [first] = errors;
			assert(first, "a refused change-password form names at least one error");
			answer({ refusal: refusalNaming(first), errors });
			return;
		}
		const verified = await verifyAccountPassword({ email: user.email, password: parsed.data.currentPassword });
		if (!verified.ok) {
			answer(refuse(VERIFY_REFUSALS[verified.reason]));
			return;
		}
		const keep = await deps.findSessionOAuthGrant(presented);
		await deps.updatePassword({
			email: user.email,
			password: parsed.data.password,
			updatedAt: deps.now().toISOString(),
		});
		const { kept } = await deps.revokeOtherUserOAuthGrants({ userId: user.userId, keep });
		await deps.destroyUserSessions(user.userId);
		const sessionId = await deps.createSession({ userId: user.userId, emailVerified: verified.emailVerified, oauthGrantId: kept });
		res.cookie(SESSION_COOKIE_NAME, sessionId, persistentSessionCookieOptions(deps.secureCookies));
		answer({ landing: buildAccountUrl({ passwordChanged: true, ...markers }) });
	});

	return router;
}
