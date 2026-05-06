import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageBody } from "../page-body.types";
import { render } from "../render";

const OAUTH_AUTHORIZE_TEMPLATE = readFileSync(join(__dirname, "oauth-authorize.template.html"), "utf-8");
const OAUTH_CALLBACK_TEMPLATE = readFileSync(join(__dirname, "oauth-callback.template.html"), "utf-8");

interface AuthorizePageParams {
	clientName: string;
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	state?: string;
}

const OAUTH_AUTHORIZE_STYLES = `
.oauth-authorize {
  padding: 80px 20px;
}

.oauth-authorize__container {
  max-width: 400px;
  margin: 0 auto;
}

.oauth-authorize__title {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 12px;
  color: var(--foreground);
}

.oauth-authorize__text {
  color: var(--muted-foreground);
  margin-bottom: 24px;
  line-height: 1.6;
}

.oauth-authorize__buttons {
  display: flex;
  gap: 1rem;
}

.oauth-authorize__btn {
  padding: 0.75rem 1.5rem;
  font-size: 1rem;
  border-radius: 4px;
  cursor: pointer;
}

.oauth-authorize__btn--approve {
  background: var(--primary);
  color: white;
  border: none;
}

.oauth-authorize__btn--deny {
  background: var(--background);
  border: 1px solid var(--border);
  color: var(--foreground);
}
`;

const OAUTH_CALLBACK_STYLES = `
.oauth-callback {
  padding: 120px 20px;
  text-align: center;
}

.oauth-callback__container {
  max-width: 400px;
  margin: 0 auto;
}

.oauth-callback__title {
  font-size: 1.5rem;
  font-weight: 700;
  margin-bottom: 12px;
  color: var(--foreground);
}

.oauth-callback__text {
  color: var(--muted-foreground);
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
		content,
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
		content: render(OAUTH_CALLBACK_TEMPLATE, {}),
	};
}
