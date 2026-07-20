export function buildInboxLinkSaveUrl(params: { emailId: string; ordinal: string }): string {
	return `/inbox/${encodeURIComponent(params.emailId)}/links/${params.ordinal}/save`;
}
