import type { EmailMessage, SendEmail } from "@packages/provider-contracts/email";

export function initInMemoryEmail(): {
	sendEmail: SendEmail;
	getSentEmails: () => EmailMessage[];
} {
	const sentEmails: EmailMessage[] = [];

	const sendEmail: SendEmail = async (message) => {
		sentEmails.push(message);
	};

	const getSentEmails = () => sentEmails;

	return { sendEmail, getSentEmails };
}
