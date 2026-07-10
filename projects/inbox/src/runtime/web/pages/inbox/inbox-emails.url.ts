import { z } from "zod";
import { EMAIL_FEATURE } from "@packages/web-shell";

export const INBOX_PATH = "/inbox";

export const INBOX_EMAILS_PAGE_SIZE = 20;

const InboxEmailsQuerySchema = z.object({
	page: z.coerce.number().int().min(1).optional().catch(undefined),
}).passthrough();

export function parseInboxEmailsUrl(query: Record<string, unknown>): { page: number } {
	const parsed = InboxEmailsQuerySchema.parse(query);
	return { page: parsed.page ?? 1 };
}

/** Every built URL carries feature=email — the whole inbox surface 404s
 * without the flag, so a link that dropped it would dead-end. */
export function buildInboxEmailsUrl(state: { page?: number }): string {
	const params = new URLSearchParams();
	params.set("feature", EMAIL_FEATURE);
	if (state.page && state.page > 1) {
		params.set("page", String(state.page));
	}
	return `${INBOX_PATH}?${params.toString()}`;
}

/** This read-boundary clamp must compute the last page the same way the
 * rendered pagination does, so they agree on where the list ends and can't
 * diverge. */
export function canonicalInboxEmailsPageRedirect(input: {
	page: number;
	total: number;
	pageSize: number;
}): string | undefined {
	const totalPages = Math.max(1, Math.ceil(input.total / input.pageSize));
	if (input.page <= totalPages) return undefined;
	return buildInboxEmailsUrl({ page: totalPages });
}
