/* c8 ignore start -- thin SDK wrapper, tested via integration */
import { Resend } from "resend";
import { EmailRejectedError, type SendEmail } from "@packages/provider-contracts/email";

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
			const message = `Resend ${result.error.name}: ${result.error.message}`;
			const statusCode = result.error.statusCode;
			// Only a 4xx is Resend refusing the message outright. A 5xx (or the
			// statusCode: null the SDK reports when the request never resolved) may
			// still have been accepted, so it must stay ambiguous — treating it as a
			// confirmed rejection would release the cooldown and let the redrive post
			// a second copy of a digest that was already delivered.
			if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
				throw new EmailRejectedError({ statusCode, message });
			}
			throw new Error(message);
		}
	};

	return { sendEmail };
}
/* c8 ignore stop */
