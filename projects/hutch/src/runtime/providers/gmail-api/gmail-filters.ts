import { z } from "zod";
import type {
	GetGmailAccessToken,
	GmailApiResult,
	GmailFilter,
	GmailFilters,
} from "@packages/provider-contracts/gmail-filters";
import { classify, initCallGmail } from "./gmail-call";

const FILTERS_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/settings/filters";

const GmailFilterResponse = z.object({
	id: z.string(),
	criteria: z.object({ query: z.string().optional() }).optional(),
	action: z.object({ forward: z.string().optional() }).optional(),
});

const GmailFilterListResponse = z.object({
	filter: z.array(GmailFilterResponse).optional(),
});

function toFilter(raw: z.infer<typeof GmailFilterResponse>): GmailFilter {
	return {
		id: raw.id,
		query: raw.criteria?.query,
		forwardTo: raw.action?.forward,
	};
}

export function initGmailFilters(deps: {
	accessToken: GetGmailAccessToken;
	fetch: typeof globalThis.fetch;
}): GmailFilters {
	const callGmail = initCallGmail(deps);

	async function parseFilter(response: Response): Promise<GmailApiResult<GmailFilter>> {
		const parsed = GmailFilterResponse.safeParse(await response.json());
		if (!parsed.success) {
			return { ok: false, reason: "rejected", status: response.status, message: "malformed filter" };
		}
		return { ok: true, value: toFilter(parsed.data) };
	}

	return {
		listFilters: async ({ userId }) =>
			classify(await callGmail(userId, { url: FILTERS_ENDPOINT, method: "GET" }), async (response) => {
				const parsed = GmailFilterListResponse.safeParse(await response.json());
				if (!parsed.success) {
					return {
						ok: false,
						reason: "rejected",
						status: response.status,
						message: "malformed filter list",
					};
				}
				return { ok: true, value: (parsed.data.filter ?? []).map(toFilter) };
			}),
		createForwardingFilter: async ({ userId, query, forwardTo }) =>
			classify(
				await callGmail(userId, {
					url: FILTERS_ENDPOINT,
					method: "POST",
					body: { criteria: { query }, action: { forward: forwardTo } },
				}),
				parseFilter,
			),
		getFilter: async ({ userId, filterId }) =>
			classify(
				await callGmail(userId, { url: `${FILTERS_ENDPOINT}/${encodeURIComponent(filterId)}`, method: "GET" }),
				parseFilter,
			),
		deleteFilter: async ({ userId, filterId }) =>
			classify(
				await callGmail(userId, { url: `${FILTERS_ENDPOINT}/${encodeURIComponent(filterId)}`, method: "DELETE" }),
				async () => ({ ok: true, value: undefined }),
			),
	};
}
