import type { UserId } from "@packages/domain/user";
import type { SendEmail } from "@packages/provider-contracts/email";
import { trialDayOf } from "../../domain/trial/trial-day";
import type { EmitLifecycleEmailSent } from "../../observability/lifecycle-email-events";
import { listUnsubscribeHeaders, unsubscribeUrlFor } from "../queue-digest-email";
import type { SignupClient } from "./signup-client";
import { buildWelcomeConnectorEmailHtml, buildWelcomeEmailHtml } from "./welcome-email";
import type { LogError } from "@packages/logger";

const WELCOME_EMAIL_FROM = "Fayner from Readplace <fayner@readplace.com>";
const WELCOME_EMAIL_REPLY_TO = "fayner@readplace.com";
const WELCOME_EMAIL_UTM_SOURCE = "welcome-email";

const CONNECTOR_WELCOMES = {
	chatgpt: { assistantName: "ChatGPT", kind: "welcome-chatgpt" },
	claude: { assistantName: "Claude", kind: "welcome-claude" },
} as const satisfies Record<Exclude<SignupClient, "other">, unknown>;

interface SendWelcomeEmailDeps {
	sendEmail: SendEmail;
	baseUrl: string;
	staticBaseUrl: string;
	logError: LogError;
	emitLifecycleEmailSent: EmitLifecycleEmailSent;
	now: () => Date;
	signUnsubscribeToken: (userId: UserId) => string;
}

type WelcomeRecipient = { email: string; userId: UserId; signupClient: SignupClient } & (
	| { tier: "trial"; trialEndsAt: string }
	| { tier: "free" }
);

export type SendWelcomeEmail = (recipient: WelcomeRecipient) => Promise<void>;

function connectorWelcomeFor(recipient: WelcomeRecipient) {
	if (recipient.tier !== "trial" || recipient.signupClient === "other") return undefined;
	return CONNECTOR_WELCOMES[recipient.signupClient];
}

function welcomeLink(input: { url: URL; content: string }): string {
	const tracked = new URL(input.url);
	tracked.searchParams.set("utm_source", WELCOME_EMAIL_UTM_SOURCE);
	tracked.searchParams.set("utm_medium", "email");
	tracked.searchParams.set("utm_campaign", "onboarding");
	tracked.searchParams.set("utm_content", input.content);
	return tracked.toString();
}

export function initSendWelcomeEmail(deps: SendWelcomeEmailDeps): SendWelcomeEmail {
	const installUrl = new URL(`${deps.baseUrl}/install`);
	const avatarUrl = `${deps.staticBaseUrl}/fayner-brack.jpg`;

	const connectorMessage = (input: { userId: UserId; assistantName: "ChatGPT" | "Claude" }) => {
		const oneClickUnsubscribeUrl = unsubscribeUrlFor({
			token: deps.signUnsubscribeToken(input.userId),
			appOrigin: deps.baseUrl,
			kind: "welcome-connector",
		});
		return {
			html: buildWelcomeConnectorEmailHtml({
				assistantName: input.assistantName,
				installUrl: welcomeLink({ url: installUrl, content: "install-connector" }),
				avatarUrl,
				unsubscribeUrl: welcomeLink({ url: oneClickUnsubscribeUrl, content: "unsubscribe" }),
			}),
			headers: listUnsubscribeHeaders(oneClickUnsubscribeUrl),
		};
	};

	return (recipient: WelcomeRecipient): Promise<void> => {
		const connector = connectorWelcomeFor(recipient);
		const message =
			connector === undefined
				? { html: buildWelcomeEmailHtml({ installUrl: welcomeLink({ url: installUrl, content: "install" }), avatarUrl }) }
				: connectorMessage({ userId: recipient.userId, assistantName: connector.assistantName });
		return deps.sendEmail({
			from: WELCOME_EMAIL_FROM,
			to: recipient.email,
			bcc: "readplace+welcome@readplace.com",
			replyTo: WELCOME_EMAIL_REPLY_TO,
			subject: "Welcome to Readplace",
			...message,
		}).then(() => {
			if (recipient.tier !== "trial") return;
			deps.emitLifecycleEmailSent({
				userId: recipient.userId,
				kind: connector === undefined ? "welcome" : connector.kind,
				trialDay: trialDayOf({ trialEndsAt: recipient.trialEndsAt, at: deps.now() }),
				utmSource: WELCOME_EMAIL_UTM_SOURCE,
				delivery: "automated",
			});
		}).catch((err) => {
			deps.logError("[Email] Welcome email failed", err instanceof Error ? err : new Error(String(err)));
		});
	};
}
