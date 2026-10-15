import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type BuiltInOAuthClientId, type SupportedClient, isBuiltInOAuthClientId } from "@packages/supported-clients";
import { render } from "@packages/web-shell";
import type { AlertContent } from "@packages/web-shell";

const NOTICE_TEMPLATE = readFileSync(join(__dirname, "oauth-authorize-notice.template.html"), "utf-8");

type ConsentAudience = "browserExtension" | "nativeApp" | "selfRegistered";

type ConsentCopy = { heading: string; body: string; notice: AlertContent | undefined };

const AUDIENCE_BY_OAUTH_ID = {
	"hutch-chrome-extension": "browserExtension",
	"hutch-firefox-extension": "browserExtension",
	"ios-app": "nativeApp",
	"android-app": "nativeApp",
} as const satisfies {
	[Id in BuiltInOAuthClientId]: Extract<SupportedClient, { auth: { oauthClientId: Id } }>["group"];
};

const COPY_BY_AUDIENCE = {
	browserExtension: ({ clientName }) => ({
		heading: `Connect the ${clientName}`,
		body: `Allow the ${clientName} to access your readlists so you can save, manage, and remove articles directly from your browser.`,
		notice: undefined,
	}),
	nativeApp: ({ clientName }) => ({
		heading: `Connect the ${clientName}`,
		body: `Allow the ${clientName} to access your readlists so you can save, manage, and remove articles from your phone.`,
		notice: undefined,
	}),
	selfRegistered: ({ clientName, redirectHost }) => ({
		heading: `Connect ${clientName}`,
		body: `Allow ${clientName} full read and write access to your readlists, including saving and deleting articles.`,
		notice: { variant: "warning", message: { html: render(NOTICE_TEMPLATE, { clientName, redirectHost }) } },
	}),
} satisfies Record<ConsentAudience, (client: { clientName: string; redirectHost: string }) => ConsentCopy>;

export function consentCopyFor(input: { clientId: string; clientName: string; redirectHost: string }): ConsentCopy {
	const audience: ConsentAudience = isBuiltInOAuthClientId(input.clientId)
		? AUDIENCE_BY_OAUTH_ID[input.clientId]
		: "selfRegistered";
	return COPY_BY_AUDIENCE[audience](input);
}
