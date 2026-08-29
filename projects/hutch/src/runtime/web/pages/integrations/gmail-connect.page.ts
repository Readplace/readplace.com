import assert from "node:assert";
import { randomBytes } from "node:crypto";
import type { Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import { baseCookieOptions } from "@packages/web-analytics";
import type {
	ForwardableSender,
	GmailConnectionStore,
	GmailCredentialsStore,
	GmailSenderStore,
} from "@packages/domain/gmail";
import type { InboxAddress } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { UserIdSchema } from "@packages/domain/user";
import { GMAIL_SETTINGS_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import type { ExchangeGmailCode } from "@packages/provider-contracts/gmail-oauth";
import { signState, verifyState } from "../../auth/oauth-state";
import { buildIntegrationsUrl, GMAIL_CALLBACK_PATH } from "./gmail-connect.url";
import { buildGmailUrl } from "./gmail.url";

const STATE_COOKIE = "hutch_gmail_state";
const STATE_TTL_MS = 5 * 60 * 1000;

const CallbackQuerySchema = z.object({ code: z.string(), state: z.string() });
const StatePayloadSchema = z.object({ nonce: z.string(), createdAt: z.number() });

export interface GmailIntegrationDependencies {
	exchangeGmailCode: ExchangeGmailCode;
	clientId: string;
	stateSecret: string;
	gmailCredentialsStore: GmailCredentialsStore;
	gmailConnectionStore: GmailConnectionStore;
	gmailSenderStore: GmailSenderStore;
	mintGatewayAddress: (input: { userId: UserId }) => Promise<InboxAddress>;
	mintSenderAddress: (input: {
		userId: UserId;
		senderEmail: ForwardableSender;
	}) => Promise<InboxAddress>;
	publishRewriteGmailFilter: (input: {
		userId: UserId;
		reason: "forwarding-confirmed" | "sender-added" | "sender-removed" | "requested";
	}) => Promise<void>;
	publishDisconnectGmail: (input: { userId: UserId }) => Promise<void>;
}

export interface GmailConnectContext {
	appOrigin: string;
	secureCookies: boolean;
	logError: (message: string, error?: Error) => void;
	now: () => Date;
	requireAuth: RequestHandler;
}

export function registerGmailConnectRoutes(
	router: Router,
	gmail: GmailIntegrationDependencies,
	context: GmailConnectContext,
): void {
	const redirectUri = `${context.appOrigin}${GMAIL_CALLBACK_PATH}`;

	router.post("/gmail/connect", context.requireAuth, (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const statePayload = JSON.stringify({
			nonce: randomBytes(16).toString("hex"),
			createdAt: context.now().getTime(),
		});
		const signedState = signState({ payload: statePayload, secret: gmail.stateSecret });

		res.cookie(STATE_COOKIE, signedState, {
			...baseCookieOptions(context.secureCookies),
			maxAge: STATE_TTL_MS,
		});

		const params = new URLSearchParams({
			client_id: gmail.clientId,
			redirect_uri: redirectUri,
			response_type: "code",
			scope: GMAIL_SETTINGS_SCOPE,
			// Google issues a refresh token only for an offline grant, and re-issues
			// one only when consent is forced; without both, a reconnect returns an
			// access token with nothing to renew it.
			access_type: "offline",
			prompt: "consent",
			state: signedState,
		});

		res.redirect(303, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
	});

	router.get("/gmail/callback", context.requireAuth, async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = UserIdSchema.parse(req.userId);
		const stateCookie = req.cookies?.[STATE_COOKIE];
		res.clearCookie(STATE_COOKIE, { path: "/" });

		if (typeof req.query.error === "string") {
			res.redirect(303, buildIntegrationsUrl({ error: "oauth_denied" }));
			return;
		}

		const parsedQuery = CallbackQuerySchema.safeParse(req.query);
		if (!parsedQuery.success || typeof stateCookie !== "string") {
			res.redirect(303, buildIntegrationsUrl({ error: "oauth_state" }));
			return;
		}
		if (parsedQuery.data.state !== stateCookie) {
			res.redirect(303, buildIntegrationsUrl({ error: "oauth_state" }));
			return;
		}
		const verified = verifyState({ signed: stateCookie, secret: gmail.stateSecret });
		if (verified === null) {
			res.redirect(303, buildIntegrationsUrl({ error: "oauth_state" }));
			return;
		}
		const statePayload = StatePayloadSchema.safeParse(JSON.parse(verified));
		if (!statePayload.success) {
			res.redirect(303, buildIntegrationsUrl({ error: "oauth_state" }));
			return;
		}
		if (context.now().getTime() - statePayload.data.createdAt > STATE_TTL_MS) {
			res.redirect(303, buildIntegrationsUrl({ error: "oauth_state" }));
			return;
		}

		const grant = await gmail.exchangeGmailCode({ code: parsedQuery.data.code });
		if (!grant.ok) {
			if (grant.reason === "scope-not-granted") {
				res.redirect(303, buildIntegrationsUrl({ error: "oauth_scope" }));
				return;
			}
			context.logError(`[gmail-connect] grant unusable: ${grant.reason}`);
			res.redirect(303, buildIntegrationsUrl({ error: "oauth_exchange" }));
			return;
		}

		await gmail.gmailCredentialsStore.saveCredentials({
			userId,
			refreshToken: grant.grant.refreshToken,
			grantedScope: grant.grant.grantedScope,
		});

		const existing = await gmail.gmailConnectionStore.findConnectionByUserId(userId);
		if (existing === undefined) {
			await gmail.gmailConnectionStore.createConnection({
				userId,
				gatewayAddress: await gmail.mintGatewayAddress({ userId }),
			});
		} else {
			await gmail.gmailConnectionStore.clearRevoked({ userId });
		}
		res.redirect(303, buildGmailUrl({ notice: "connected" }));
	});
}
