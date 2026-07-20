export function buildInboxLinkFeedbackUrl(params: { emailId: string; ordinal: string }): string {
	return `/inbox/${encodeURIComponent(params.emailId)}/links/${params.ordinal}/feedback`;
}
