import { z } from "zod";
import type { UserId } from "@packages/domain/user";
import type {
	GetGmailAccessToken,
	GmailApiResult,
	GmailFilter,
	GmailFilters,
} from "@packages/provider-contracts/gmail-filters";

const FILTERS_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/settings/filters";

const GmailFilterResponse = z.object({
	id: z.string(),
	criteria: z.object({ query: z.string().optional() }).optional(),
	action: z.object({ forward: z.string().optional() }).optional(),
});

const GmailFilterListResponse = z.object({
	filter: z.array(GmailFilterResponse).optional(),
});

const GmailErrorResponse = z.object({
	error: z.object({ message: z.string() }),
});

function toFilter(raw: z.infer<typeof GmailFilterResponse>): GmailFilter {
	return {
		id: raw.id,
		query: raw.criteria?.query,
		forwardTo: raw.action?.forward,
	};
}

async function rejection(response: Response): Promise<GmailApiResult<never>> {
	const parsed = GmailErrorResponse.safeParse(await response.json().catch(() => undefined));
	return {
		ok: false,
		reason: "rejected",
		status: response.status,
		message: parsed.success ? parsed.data.error.message : response.statusText,
	};
}

export function initGmailFilters(deps: {
	accessToken: GetGmailAccessToken;
	fetch: typeof globalThis.fetch;
}): GmailFilters {
	async function callGmail(
		userId: UserId,
		request: { path: string; method: string; body?: unknown },
	): Promise<GmailApiResult<Response>> {
		async function attempt(forceRefresh: boolean): Promise<GmailApiResult<Response>> {
			const token = await deps.accessToken({ userId, forceRefresh });
			if (!token.ok) return token;
			const response = await deps.fetch(`${FILTERS_ENDPOINT}${request.path}`, {
				method: request.method,
				headers: {
					Authorization: `Bearer ${token.value}`,
					...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
				},
				...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
			});
			return { ok: true, value: response };
		}

		const first = await attempt(false);
		if (!first.ok || first.value.status !== 401) return first;
		const second = await attempt(true);
		if (second.ok && second.value.status === 401) return { ok: false, reason: "reauth-required" };
		return second;
	}

	async function classify<TValue>(
		call: GmailApiResult<Response>,
		onOk: (response: Response) => Promise<GmailApiResult<TValue>>,
	): Promise<GmailApiResult<TValue>> {
		if (!call.ok) return call;
		const response = call.value;
		if (response.ok) return onOk(response);
		if (response.status === 429 || response.status >= 500) {
			return { ok: false, reason: "unavailable", status: response.status };
		}
		return rejection(response);
	}

	async function parseFilter(response: Response): Promise<GmailApiResult<GmailFilter>> {
		const parsed = GmailFilterResponse.safeParse(await response.json());
		if (!parsed.success) {
			return { ok: false, reason: "rejected", status: response.status, message: "malformed filter" };
		}
		return { ok: true, value: toFilter(parsed.data) };
	}

	return {
		listFilters: async ({ userId }) =>
			classify(await callGmail(userId, { path: "", method: "GET" }), async (response) => {
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
					path: "",
					method: "POST",
					body: { criteria: { query }, action: { forward: forwardTo } },
				}),
				parseFilter,
			),
		getFilter: async ({ userId, filterId }) =>
			classify(
				await callGmail(userId, { path: `/${encodeURIComponent(filterId)}`, method: "GET" }),
				parseFilter,
			),
		deleteFilter: async ({ userId, filterId }) =>
			classify(
				await callGmail(userId, { path: `/${encodeURIComponent(filterId)}`, method: "DELETE" }),
				async () => ({ ok: true, value: undefined }),
			),
	};
}
