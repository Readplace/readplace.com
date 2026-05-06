import type { SendEmail } from "@packages/test-fixtures/providers/email";
import { buildWelcomeEmailHtml } from "./welcome-email";

const WELCOME_EMAIL_FROM = "Fayner from Readplace <fayner@readplace.com>";

interface SendWelcomeEmailDeps {
	sendEmail: SendEmail;
	baseUrl: string;
	staticBaseUrl: string;
	logError: (message: string, error?: Error) => void;
}

export type SendWelcomeEmail = (email: string) => void;

export function initSendWelcomeEmail(deps: SendWelcomeEmailDeps): SendWelcomeEmail {
	return (email: string): void => {
		const installUrl = `${deps.baseUrl}/install`;
		const avatarUrl = `${deps.staticBaseUrl}/fayner-brack.jpg`;
		deps.sendEmail({
			from: WELCOME_EMAIL_FROM,
			to: email,
			bcc: "readplace+welcome@readplace.com",
			subject: "Welcome to Readplace",
			html: buildWelcomeEmailHtml({ installUrl, avatarUrl }),
		}).catch((err) => {
			deps.logError("[Email] Welcome email failed", err instanceof Error ? err : new Error(String(err)));
		});
	};
}
