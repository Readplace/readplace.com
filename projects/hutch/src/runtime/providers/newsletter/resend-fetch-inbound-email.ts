/* c8 ignore start -- thin Resend API wrapper, tested via integration */
import { z } from "zod";
import type { FetchInboundEmail } from "@packages/domain/newsletter";

/** Resend's `email.received` webhook is metadata-only; the rendered body is
 * retrieved separately by id. We call the inbound retrieval endpoint directly
 * (rather than via a typed SDK method) so this adapter stays decoupled from the
 * SDK's evolving inbound surface. */
const InboundEmailResponse = z.object({
	html: z.string().nullish(),
	text: z.string().nullish(),
});

export function initResendFetchInboundEmail(deps: {
	apiKey: string;
	fetch: typeof globalThis.fetch;
}): { fetchInboundEmail: FetchInboundEmail } {
	const fetchInboundEmail: FetchInboundEmail = async (emailId) => {
		const response = await deps.fetch(
			`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
			{ headers: { Authorization: `Bearer ${deps.apiKey}` } },
		);
		if (!response.ok) return undefined;
		const parsed = InboundEmailResponse.safeParse(await response.json());
		if (!parsed.success) return undefined;
		const html = parsed.data.html ?? (parsed.data.text ? `<pre>${parsed.data.text}</pre>` : "");
		return { html };
	};

	return { fetchInboundEmail };
}
/* c8 ignore stop */
