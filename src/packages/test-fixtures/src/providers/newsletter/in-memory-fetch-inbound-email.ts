import type {
	FetchInboundEmail,
	InboundEmailContent,
} from "@packages/domain/newsletter";

/** In-memory stand-in for the Resend "fetch inbound body by id" call. Tests
 * seed a body keyed by the webhook's `email_id` before posting the webhook. */
export function initInMemoryFetchInboundEmail(): {
	fetchInboundEmail: FetchInboundEmail;
	seedInboundEmail: (emailId: string, content: InboundEmailContent) => void;
} {
	const bodies = new Map<string, InboundEmailContent>();
	return {
		fetchInboundEmail: async (emailId) => bodies.get(emailId),
		seedInboundEmail: (emailId, content) => {
			bodies.set(emailId, content);
		},
	};
}
