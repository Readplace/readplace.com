import { z } from "zod";
import type { UserId } from "@packages/domain/user";
import type { GetGmailAccessToken, GmailApiResult } from "@packages/provider-contracts/gmail-filters";

export const GmailErrorResponse = z.object({
	error: z.object({ message: z.string() }),
});

export function rejectionFrom(input: {
	response: Response;
	body: z.ZodSafeParseResult<z.output<typeof GmailErrorResponse>>;
}): GmailApiResult<never> {
	return {
		ok: false,
		reason: "rejected",
		status: input.response.status,
		message: input.body.success ? input.body.data.error.message : input.response.statusText,
	};
}

export async function rejection(response: Response): Promise<GmailApiResult<never>> {
	return rejectionFrom({ response, body: GmailErrorResponse.safeParse(await response.json().catch(() => undefined)) });
}

export async function classifyWith<TValue>(
	call: GmailApiResult<Response>,
	handle: {
		onOk: (response: Response) => Promise<GmailApiResult<TValue>>;
		onRefused: (response: Response) => Promise<GmailApiResult<never>>;
	},
): Promise<GmailApiResult<TValue>> {
	if (!call.ok) return call;
	const response = call.value;
	if (response.ok) return handle.onOk(response);
	if (response.status === 429 || response.status >= 500) {
		return { ok: false, reason: "unavailable", status: response.status };
	}
	return handle.onRefused(response);
}

export async function classify<TValue>(
	call: GmailApiResult<Response>,
	onOk: (response: Response) => Promise<GmailApiResult<TValue>>,
): Promise<GmailApiResult<TValue>> {
	return classifyWith(call, { onOk, onRefused: rejection });
}

export function initCallGmail(deps: {
	accessToken: GetGmailAccessToken;
	fetch: typeof globalThis.fetch;
}) {
	return async function callGmail(
		userId: UserId,
		request: { url: string; method: string; body?: unknown },
	): Promise<GmailApiResult<Response>> {
		async function attempt(forceRefresh: boolean): Promise<GmailApiResult<Response>> {
			const token = await deps.accessToken({ userId, forceRefresh });
			if (!token.ok) return token;
			const response = await deps.fetch(request.url, {
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
	};
}
