import { GMAIL_NEWSLETTER_NOTICE_MAX_NEWSLETTERS } from "./gmail-newsletter-notice-cadence";

export function selectGmailNewsletterNotices<T extends { senderEmail: string; pendingSince: number | undefined }>(candidates: readonly T[]): { listed: T[]; waiting: number } {
	const ageOf = (candidate: T) => (candidate.pendingSince === undefined ? 0 : candidate.pendingSince);
	const listed = [...candidates].sort((a, b) => {
		const byAge = ageOf(a) - ageOf(b);
		if (byAge !== 0) return byAge;
		return a.senderEmail.localeCompare(b.senderEmail);
	}).slice(0, GMAIL_NEWSLETTER_NOTICE_MAX_NEWSLETTERS);
	return { listed, waiting: candidates.length - listed.length };
}
