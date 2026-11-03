import {
	classifyEmailLink,
	type EmailLinkClassification,
	type EmailLinkContext,
} from "./classify-email-link";
import { parseHttpUrl } from "./parse-http-url";

const SOCIAL_HOSTS: ReadonlySet<string> = new Set([
	"x.com",
	"www.x.com",
	"linkedin.com",
	"www.linkedin.com",
]);

function isSocialHost(url: string): boolean {
	const parsed = parseHttpUrl(url);
	if (parsed === undefined) return false;
	return SOCIAL_HOSTS.has(parsed.hostname.replace(/\.$/, ""));
}

export function classifyForwardedEmailLink(link: EmailLinkContext): EmailLinkClassification {
	const classification = classifyEmailLink(link);
	if (classification.action === "skip" || !isSocialHost(link.url)) return classification;
	return { action: "skip", reason: "social-host" };
}
