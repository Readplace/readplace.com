/* c8 ignore start -- thin SDK wrapper, tested via integration */
import { Resend } from "resend";
import type { SendEmail } from "./email.types";

export function initResendEmail(apiKey: string): { sendEmail: SendEmail } {
	const resend = new Resend(apiKey);

	const sendEmail: SendEmail = async (message) => {
		const result = await resend.emails.send({
			from: message.from,
			to: message.to,
			subject: message.subject,
			html: message.html,
			...(message.text && { text: message.text }),
			...(message.bcc && { bcc: message.bcc }),
			...(message.replyTo && { replyTo: message.replyTo }),
		});
		if (result.error) {
			throw new Error(`Resend ${result.error.name}: ${result.error.message}`);
		}
	};

	return { sendEmail };
}
/* c8 ignore stop */
