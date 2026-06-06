import {
	NewsletterInboxTokenSchema,
	type NewsletterInboxToken,
} from "./newsletter.schema";

const ANGLE_BRACKET_ADDRESS = /<([^>]+)>/;

export function buildInboxAddress(input: {
	token: NewsletterInboxToken;
	domain: string;
}): string {
	return `${input.token}@${input.domain}`;
}

/** Normalizes a recipient header value (`"Name <a@b.com>"` or `"a@b.com"`) to
 * a bare, lowercased email address. */
function normalizeRecipient(recipient: string): string {
	const captured = ANGLE_BRACKET_ADDRESS.exec(recipient)?.[1];
	return (captured ?? recipient).trim().toLowerCase();
}

/** Extracts the inbox token from a single recipient, or null when the recipient
 * is not an address on `domain` whose local-part is a valid token. */
export function parseInboxToken(input: {
	recipient: string;
	domain: string;
}): NewsletterInboxToken | null {
	const email = normalizeRecipient(input.recipient);
	const atIndex = email.lastIndexOf("@");
	if (atIndex === -1) return null;
	const localPart = email.slice(0, atIndex);
	const host = email.slice(atIndex + 1);
	if (host !== input.domain.toLowerCase()) return null;
	const parsed = NewsletterInboxTokenSchema.safeParse(localPart);
	return parsed.success ? parsed.data : null;
}

/** Returns the first recipient that resolves to an inbox token, or null. */
export function findInboxToken(input: {
	recipients: readonly string[];
	domain: string;
}): NewsletterInboxToken | null {
	for (const recipient of input.recipients) {
		const token = parseInboxToken({ recipient, domain: input.domain });
		if (token) return token;
	}
	return null;
}
