import type { HutchLogger } from "@packages/hutch-logger";
import type { SendEmail } from "@packages/provider-contracts/email";

const RESERVED_DOMAINS: ReadonlySet<string> = new Set([
	"example.com",
	"example.net",
	"example.org",
]);

const RESERVED_TLDS: ReadonlySet<string> = new Set([
	"test",
	"example",
	"invalid",
	"localhost",
]);

function reservedDomainOf(address: string): string | undefined {
	const domain = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
	const tld = domain.slice(domain.lastIndexOf(".") + 1);
	if (RESERVED_DOMAINS.has(domain) || RESERVED_TLDS.has(tld)) return domain;
	return undefined;
}

export function initSkipReservedDomain(deps: {
	sendEmail: SendEmail;
	logger: HutchLogger;
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
