import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { AUTH_STYLES } from "../auth/auth.styles";

const OAUTH_AUTHORIZE_TEMPLATE = readFileSync(join(__dirname, "oauth-authorize.template.html"), "utf-8");
const OAUTH_CALLBACK_TEMPLATE = readFileSync(join(__dirname, "oauth-callback.template.html"), "utf-8");

interface AuthorizePageParams {
	clientName: string;
	clientId: string;
	redirectUri: string;
	redirectHost: string;
	selfRegistered: boolean;
	codeChallenge: string;
	state?: string;
	userEmail?: string;
	screenHint?: "login" | "signup";
}

const OAUTH_AUTHORIZE_STYLES = `${AUTH_STYLES}
.oauth-authorize__title {
	font-family: var(--font-sans);
	font-size: 1.0625rem;
	font-weight: 600;
	line-height: 1.3;
	margin-bottom: 8px;
	color: var(--foreground);
	text-wrap: balance;
	overflow-wrap: anywhere;
}

.oauth-authorize__text {
	font-size: 0.875rem;
	color: var(--muted-foreground);
	margin-bottom: 24px;
	line-height: 1.6;
	text-wrap: pretty;
	overflow-wrap: anywhere;
}

.oauth-authorize__notice {
	background: var(--muted);
	border: 1px solid var(--border);
	color: var(--foreground);
	padding: 14px 16px;
	border-radius: var(--radius);
	margin: 16px 0 20px;
	font-size: 0.875rem;
	line-height: 1.5;
	text-wrap: pretty;
	overflow-wrap: anywhere;
}

.oauth-authorize__buttons {
	display: flex;
	gap: 12px;
}

.oauth-authorize__button {
	flex: 1 1 0;
}

.oauth-authorize__account {
	color: var(--muted-foreground);
	margin-bottom: 20px;
	font-size: 0.8125rem;
	overflow-wrap: anywhere;
}

.oauth-authorize__switch {
	display: block;
	width: 100%;
	min-height: 44px;
	margin-top: 8px;
	background: none;
	border: none;
	font: inherit;
	font-size: 0.875rem;
	color: var(--primary-text);
	text-align: center;
	text-decoration: underline;
	cursor: pointer;
}
`;

const OAUTH_CALLBACK_STYLES = `${AUTH_STYLES}
.oauth-callback__text {
	font-size: 0.875rem;
	color: var(--muted-foreground);
	text-align: center;
	text-wrap: pretty;
}
`;

export function OAuthAuthorizePage(params: AuthorizePageParams): PageBody {
	const content = render(OAUTH_AUTHORIZE_TEMPLATE, params);

	return {
		seo: {
			title: `Authorize ${params.clientName} — Readplace`,
			description: `${params.clientName} is requesting access to your Readplace account.`,
			canonicalUrl: "/oauth/authorize",
			robots: "noindex, nofollow",
		},
		styles: OAUTH_AUTHORIZE_STYLES,
		bodyClass: "page-oauth-authorize",
		content: { html: content },
	};
}

export function OAuthCallbackPage(): PageBody {
	return {
		seo: {
			title: "Authorization Complete — Readplace",
			description: "OAuth authorization is complete.",
			canonicalUrl: "/oauth/callback",
			robots: "noindex, nofollow",
		},
		styles: OAUTH_CALLBACK_STYLES,
		bodyClass: "page-oauth-callback",
		content: { html: render(OAUTH_CALLBACK_TEMPLATE, {}) },
	};
}
