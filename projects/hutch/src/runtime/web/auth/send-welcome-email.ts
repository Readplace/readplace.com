import type { UserId } from "@packages/domain/user";
import type { SendEmail } from "@packages/provider-contracts/email";
import { trialDayOf } from "../../domain/trial/trial-day";
import type { EmitLifecycleEmailSent } from "../../observability/lifecycle-email-events";
import { buildWelcomeEmailHtml } from "./welcome-email";

const WELCOME_EMAIL_FROM = "Fayner from Readplace <fayner@readplace.com>";
const WELCOME_EMAIL_REPLY_TO = "fayner@readplace.com";
const WELCOME_EMAIL_UTM_SOURCE = "welcome-email";

interface SendWelcomeEmailDeps {
	sendEmail: SendEmail;
	baseUrl: string;
	staticBaseUrl: string;
	logError: (message: string, error?: Error) => void;
	emitLifecycleEmailSent: EmitLifecycleEmailSent;
	now: () => Date;
}

type WelcomeRecipient = { email: string; userId: UserId } & (
	| { tier: "trial"; trialEndsAt: string }
	| { tier: "free" }
);

export type SendWelcomeEmail = (recipient: WelcomeRecipient) => Promise<void>;

export function initSendWelcomeEmail(deps: SendWelcomeEmailDeps): SendWelcomeEmail {
	return (recipient: WelcomeRecipient): Promise<void> => {
		const installUrl = new URL(`${deps.baseUrl}/install`);
		installUrl.searchParams.set("utm_source", WELCOME_EMAIL_UTM_SOURCE);
		installUrl.searchParams.set("utm_medium", "email");
		installUrl.searchParams.set("utm_campaign", "onboarding");
		installUrl.searchParams.set("utm_content", "install");
		const avatarUrl = `${deps.staticBaseUrl}/fayner-brack.jpg`;
		return deps.sendEmail({
			from: WELCOME_EMAIL_FROM,
			to: recipient.email,
			bcc: "readplace+welcome@readplace.com",
			replyTo: WELCOME_EMAIL_REPLY_TO,
			subject: "Welcome to Readplace",
			html: buildWelcomeEmailHtml({ installUrl: installUrl.toString(), avatarUrl }),
		}).then(() => {
			if (recipient.tier !== "trial") return;
			deps.emitLifecycleEmailSent({
				userId: recipient.userId,
				kind: "welcome",
				trialDay: trialDayOf({ trialEndsAt: recipient.trialEndsAt, at: deps.now() }),
				utmSource: WELCOME_EMAIL_UTM_SOURCE,
				delivery: "automated",
			});
		}).catch((err) => {
			deps.logError("[Email] Welcome email failed", err instanceof Error ? err : new Error(String(err)));
		});
	};
}
