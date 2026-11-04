import type { Logger } from "@packages/logger";
import type { SendEmail } from "@packages/provider-contracts/email";
import { reservedDomainOf } from "../../domain/email/reserved-domain";

export function initSkipReservedDomain(deps: {
	sendEmail: SendEmail;
	logger: Logger;
}): { sendEmail: SendEmail } {
	const { sendEmail: inner, logger } = deps;

	const sendEmail: SendEmail = async (message) => {
		const reserved = reservedDomainOf(message.to);
		if (reserved) {
			logger.warn("[email] reserved recipient domain — not sent", {
				domain: reserved,
				subject: message.subject,
			});
			return;
		}
		await inner(message);
	};

	return { sendEmail };
}
