import type { Logger } from "@packages/logger";
import type { SendEmail } from "@packages/provider-contracts/email";

export function initLogEmail(deps: { logger: Logger }): { sendEmail: SendEmail } {
	const { logger } = deps;
	const sendEmail: SendEmail = async (message) => {
		logger.info("[Email]", {
			from: message.from,
			to: message.to,
			bcc: message.bcc,
			replyTo: message.replyTo,
			subject: message.subject,
			html: message.html,
			text: message.text,
			headers: message.headers,
		});
	};

	return { sendEmail };
}
