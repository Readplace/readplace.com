import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderAlert } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { AUTH_STYLES } from "../auth/auth.styles";
import { consentCopyFor } from "./consent-copy";
import { OAUTH_AUTHORIZE_STYLES } from "./oauth-authorize.styles";

const OAUTH_AUTHORIZE_TEMPLATE = readFileSync(join(__dirname, "oauth-authorize.template.html"), "utf-8");
const OAUTH_CALLBACK_TEMPLATE = readFileSync(join(__dirname, "oauth-callback.template.html"), "utf-8");

interface AuthorizePageParams {
	clientName: string;
	clientId: string;
	redirectUri: string;
	redirectHost: string;
	codeChallenge: string;
	state?: string;
	userEmail?: string;
	screenHint?: "login" | "signup";
}

const ACCOUNT_STATE_CLASS = {
	known: "oauth-authorize__account--visible",
	unknown: "oauth-authorize__account--hidden",
} as const;

const OAUTH_CALLBACK_STYLES = `${AUTH_STYLES}
.oauth-callback__text {
	font-size: 0.875rem;
	color: var(--muted-foreground);
	text-align: center;
	text-wrap: pretty;
}
`;

export function OAuthAuthorizePage(params: AuthorizePageParams): PageBody {
	const copy = consentCopyFor(params);
	const content = render(OAUTH_AUTHORIZE_TEMPLATE, {
		...params,
		heading: copy.heading,
		body: copy.body,
		noticeHtml: renderAlert({ key: "consent-notice", content: copy.notice }),
		accountStateClass: ACCOUNT_STATE_CLASS[params.userEmail === undefined ? "unknown" : "known"],
	});

	return {
		seo: {
			title: `${copy.heading} — Readplace`,
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
