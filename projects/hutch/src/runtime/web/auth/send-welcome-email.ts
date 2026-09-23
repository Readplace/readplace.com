import type { SendEmail } from "@packages/provider-contracts/email";
import { buildWelcomeEmailHtml } from "./welcome-email";

const WELCOME_EMAIL_FROM = "Fayner from Readplace <fayner@readplace.com>";
const WELCOME_EMAIL_REPLY_TO = "fayner@readplace.com";

interface SendWelcomeEmailDeps {
	sendEmail: SendEmail;
	baseUrl: string;
	staticBaseUrl: string;
	logError: (message: string, error?: Error) => void;
}

export type SendWelcomeEmail = (email: string) => void;

export function initSendWelcomeEmail(deps: SendWelcomeEmailDeps): SendWelcomeEmail {
	return (email: string): void => {
		const installUrl = new URL(`${deps.baseUrl}/install`);
		installUrl.searchParams.set("utm_source", "welcome-email");
		installUrl.searchParams.set("utm_medium", "email");
		installUrl.searchParams.set("utm_campaign", "onboarding");
		installUrl.searchParams.set("utm_content", "install");
		const avatarUrl = `${deps.staticBaseUrl}/fayner-brack.jpg`;
		deps.sendEmail({
			from: WELCOME_EMAIL_FROM,
			to: email,
			bcc: "readplace+welcome@readplace.com",
			replyTo: WELCOME_EMAIL_REPLY_TO,
			subject: "Welcome to Readplace",
			html: buildWelcomeEmailHtml({ installUrl: installUrl.toString(), avatarUrl }),
		}).catch((err) => {
			deps.logError("[Email] Welcome email failed", err instanceof Error ? err : new Error(String(err)));
		});
	};
}
