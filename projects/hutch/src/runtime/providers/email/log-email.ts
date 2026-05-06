import type { SendEmail } from "./email.types";

export function initLogEmail(): { sendEmail: SendEmail } {
	const sendEmail: SendEmail = async (message) => {
		console.log("[Email]", {
			from: message.from,
			to: message.to,
			bcc: message.bcc,
			replyTo: message.replyTo,
			subject: message.subject,
			html: message.html,
			text: message.text,
		});
	};

	return { sendEmail };
}
