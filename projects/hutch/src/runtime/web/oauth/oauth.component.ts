import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderAlert } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { AUTH_STYLES } from "../auth/auth.styles";
import { consentCopyFor } from "./consent-copy";
import { OAUTH_AUTHORIZE_STYLES } from "./oauth-authorize.styles";
import { obsidianHandoffHref, type ObsidianHandoff } from "./obsidian-handoff";

const OAUTH_AUTHORIZE_TEMPLATE = readFileSync(join(__dirname, "oauth-authorize.template.html"), "utf-8");
const OAUTH_CALLBACK_TEMPLATE = readFileSync(join(__dirname, "oauth-callback.template.html"), "utf-8");
const OAUTH_OBSIDIAN_HANDOFF_TEMPLATE = readFileSync(join(__dirname, "oauth-obsidian-handoff.template.html"), "utf-8");
const OAUTH_OBSIDIAN_HANDOFF_SCRIPT = `<script src="/client-dist/oauth-obsidian-handoff.client.js" defer></script>`;

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

const OAUTH_OBSIDIAN_HANDOFF_STYLES = `${OAUTH_CALLBACK_STYLES}
.oauth-obsidian__return {
	width: 100%;
	margin-top: 16px;
}
.oauth-obsidian__copy-field {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 4px 12px;
	margin-top: 16px;
	padding: 12px 16px;
	border: 1px solid var(--border);
	border-radius: var(--radius);
	background: var(--muted);
}
.oauth-obsidian__copy-label {
	flex: 1 0 100%;
	font-size: var(--text-sm);
	font-weight: 500;
	color: var(--muted-foreground);
}
.oauth-obsidian__copy-value {
	flex: 1 1 0;
	min-width: 0;
	font-family: var(--font-mono);
	font-size: var(--text-md);
	overflow-wrap: anywhere;
	color: var(--foreground);
}
.oauth-obsidian__copy-button {
	flex: none;
}
.oauth-obsidian__copy-button[hidden] {
	display: none;
}
`;

interface ObsidianHandoffView {
	heading: string;
	body: string;
	returnLinks: { href: string; variantClass: string }[];
	signInCodes: string[];
	statusCode: number;
}

function obsidianHandoffView(handoff: ObsidianHandoff): ObsidianHandoffView {
	if (handoff.kind === "invalid") {
		return {
			heading: "This link is incomplete",
			body: "Start the sign-in again from the Readplace settings in Obsidian.",
			returnLinks: [],
			signInCodes: [],
			statusCode: 400,
		};
	}
	if (handoff.kind === "error") {
		return {
			heading: "Sign-in cancelled",
			body: "Nothing was connected. You can return to Obsidian or close this window.",
			returnLinks: [{ href: obsidianHandoffHref(handoff), variantClass: "btn--secondary" }],
			signInCodes: [],
			statusCode: 200,
		};
	}
	return {
		heading: "Sign-in approved",
		body: "Return to Obsidian to finish signing in.",
		returnLinks: [{ href: obsidianHandoffHref(handoff), variantClass: "btn--primary" }],
		signInCodes: [handoff.code],
		statusCode: 200,
	};
}

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

export function OAuthObsidianHandoffPage(handoff: ObsidianHandoff): PageBody {
	const { statusCode, ...view } = obsidianHandoffView(handoff);
	return {
		seo: {
			title: "Return to Obsidian — Readplace",
			description: "Return to Obsidian to finish signing in to Readplace.",
			canonicalUrl: "/oauth/obsidian",
			robots: "noindex, nofollow",
		},
		styles: OAUTH_OBSIDIAN_HANDOFF_STYLES,
		bodyClass: "page-oauth-obsidian",
		content: { html: render(OAUTH_OBSIDIAN_HANDOFF_TEMPLATE, view) },
		scripts: OAUTH_OBSIDIAN_HANDOFF_SCRIPT,
		statusCode,
	};
}
