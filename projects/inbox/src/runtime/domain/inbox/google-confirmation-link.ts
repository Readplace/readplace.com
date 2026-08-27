import { parseHttpUrl } from "@packages/domain/inbox";
import { collectEmailAnchors } from "./collect-email-anchors";

export const GOOGLE_FORWARDING_SENDER = "forwarding-noreply@google.com";

const CONFIRMATION_HOSTS: ReadonlySet<string> = new Set([
	"mail-settings.google.com",
	"mail.google.com",
]);
const CONFIRMATION_HOST = "mail.google.com";
const CONFIRMATION_PATH_PREFIX = "/mail/vf-";

export interface GoogleConfirmationCandidate {
	from: string;
	googleAddressConfirmation: string | undefined;
	html: string;
	text: string;
}

export function findGoogleForwardingConfirmationUrl(
	input: GoogleConfirmationCandidate,
): string | undefined {
	if (input.googleAddressConfirmation === undefined) return undefined;
	if (input.from.trim().toLowerCase() !== GOOGLE_FORWARDING_SENDER) return undefined;
	for (const candidate of [...collectEmailAnchors(input.html).keys(), ...textTokens(input.text)]) {
		const confirmed = toConfirmationUrl(candidate);
		if (confirmed !== undefined) return confirmed;
	}
	return undefined;
}

function textTokens(text: string): string[] {
	return text.split(/\s+/).map((token) => token.replace(/[.,)\]]+$/, ""));
}

function toConfirmationUrl(candidate: string): string | undefined {
	const url = parseHttpUrl(candidate);
	if (url === undefined) return undefined;
	if (!CONFIRMATION_HOSTS.has(url.hostname)) return undefined;
	if (!url.pathname.startsWith(CONFIRMATION_PATH_PREFIX)) return undefined;
	return new URL(`${url.pathname}${url.search}`, `https://${CONFIRMATION_HOST}`).toString();
}
