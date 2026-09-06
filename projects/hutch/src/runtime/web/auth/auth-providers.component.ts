import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";
import type { LastAuthProvider } from "../last-auth-provider";

const AUTH_PROVIDERS_TEMPLATE = readFileSync(
	join(__dirname, "auth-providers.template.html"),
	"utf-8",
);

const GOOGLE_LOGO_SVG = `<svg class="auth-provider-button__logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.806.54-1.8368.8595-3.0477.8595-2.344 0-4.3282-1.5831-5.0364-3.7104H.9573v2.3318C2.4382 15.9831 5.4818 18 9 18z"/><path fill="#FBBC05" d="M3.9636 10.71c-.18-.54-.2823-1.1168-.2823-1.71s.1023-1.17.2823-1.71V4.9582H.9573A8.9965 8.9965 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.9636 10.71z"/><path fill="#EA4335" d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.9636 7.29C4.6718 5.1627 6.6559 3.5795 9 3.5795z"/></svg>`;

const APPLE_LOGO_SVG = `<svg class="auth-provider-button__logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.05 12.04c-.03-2.4 1.96-3.55 2.05-3.61-1.12-1.64-2.86-1.86-3.48-1.89-1.48-.15-2.89.87-3.64.87-.75 0-1.91-.85-3.14-.83-1.62.02-3.11.94-3.94 2.39-1.68 2.92-.43 7.24 1.2 9.61.8 1.16 1.75 2.46 3 2.41 1.2-.05 1.66-.78 3.11-.78 1.45 0 1.86.78 3.14.75 1.29-.02 2.11-1.18 2.9-2.35.91-1.35 1.29-2.65 1.31-2.72-.03-.01-2.51-.97-2.54-3.83zM14.63 5.16c.66-.8 1.11-1.92.99-3.03-.95.04-2.11.63-2.8 1.43-.62.71-1.16 1.85-1.01 2.94 1.06.08 2.15-.54 2.82-1.34z"/></svg>`;

type AuthIntent = "sign-in" | "sign-up";

interface AuthProviderSpec {
	key: LastAuthProvider;
	name: string;
	logoSvg: string;
	buttonClass: string;
	utmContent: Record<AuthIntent, string>;
	supportsAccountChooser: boolean;
}

const AUTH_PROVIDERS: readonly AuthProviderSpec[] = [
	{
		key: "google",
		name: "Google",
		logoSvg: GOOGLE_LOGO_SVG,
		buttonClass: "auth-provider-button auth-provider-button--google",
		utmContent: { "sign-up": "google-signup-btn", "sign-in": "google-login-btn" },
		supportsAccountChooser: true,
	},
	{
		key: "apple",
		name: "Apple",
		logoSvg: APPLE_LOGO_SVG,
		buttonClass: "auth-provider-button auth-provider-button--apple",
		utmContent: { "sign-up": "apple-signup-btn", "sign-in": "apple-login-btn" },
		supportsAccountChooser: false,
	},
];

const INTENT_VERB: Record<AuthIntent, string> = {
	"sign-in": "Sign in with",
	"sign-up": "Sign up with",
};

const LAST_USED_BADGE = { text: "Last used" };

const AUTH_PAGE_SOURCE = "auth-page";

function providerHref(input: {
	spec: AuthProviderSpec;
	intent: AuthIntent;
	returnUrl?: string;
	chooseAccount?: boolean;
}): string {
	const params = new URLSearchParams();
	if (input.returnUrl) params.set("return", input.returnUrl);
	if (input.chooseAccount && input.spec.supportsAccountChooser) {
		params.set("prompt", "select_account");
	}
	const query = params.toString();
	const href = query ? `/auth/${input.spec.key}?${query}` : `/auth/${input.spec.key}`;
	return withInternalTracking(href, {
		source: AUTH_PAGE_SOURCE,
		content: input.spec.utmContent[input.intent],
	});
}

export function renderAuthProviders(input: {
	intent: AuthIntent;
	returnUrl?: string;
	chooseAccount?: boolean;
	lastUsedProvider?: LastAuthProvider;
}): string {
	const providers = AUTH_PROVIDERS.map((spec) => {
		const isLastUsed = spec.key === input.lastUsedProvider;
		return {
			key: spec.key,
			label: `${INTENT_VERB[input.intent]} ${spec.name}`,
			href: providerHref({
				spec,
				intent: input.intent,
				returnUrl: input.returnUrl,
				chooseAccount: input.chooseAccount,
			}),
			logoSvg: spec.logoSvg,
			buttonClass: spec.buttonClass,
			isLastUsed,
			badges: isLastUsed ? [LAST_USED_BADGE] : [],
		};
	});
	return render(AUTH_PROVIDERS_TEMPLATE, { providers });
}
