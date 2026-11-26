import { z } from "zod";
import type { UserId } from "@packages/domain/user";
import type { GetGmailAccessToken, GmailApiResult } from "@packages/provider-contracts/gmail-filters";

export const GmailErrorResponse = z.object({
	error: z.object({ message: z.string() }),
});

export const GmailErrorReasons = z.object({
	error: z.object({
		errors: z.array(z.object({ reason: z.string() })).optional(),
		details: z.array(z.object({ reason: z.string().optional() })).optional(),
	}),
});

export function gmailErrorReasons(body: z.output<typeof GmailErrorReasons>): string[] {
	return [
		...(body.error.errors ?? []).map((error) => error.reason),
		...(body.error.details ?? []).map((detail) => detail.reason).filter((reason) => reason !== undefined),
	];
}

const RATE_LIMITED = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);
const SCOPE_MISSING = new Set(["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"]);

export function isRateLimited(reasons: readonly string[]): boolean {
	return reasons.some((reason) => RATE_LIMITED.has(reason));
}

export function isScopeMissing(reasons: readonly string[]): boolean {
	return reasons.some((reason) => SCOPE_MISSING.has(reason));
}

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

export async function classifyWith<TValue, TRefusal = GmailApiResult<never>>(
	call: GmailApiResult<Response>,
	handle: {
		onOk: (response: Response) => Promise<GmailApiResult<TValue>>;
		onRefused: (response: Response) => Promise<TRefusal>;
	},
): Promise<GmailApiResult<TValue> | TRefusal> {
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
		request: { url: string; method: string; body?: unknown; forceRefresh?: true },
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

		const forced = request.forceRefresh === true;
		const first = await attempt(forced);
		if (!first.ok || first.value.status !== 401) return first;
		const second = forced ? first : await attempt(true);
		if (second.ok && second.value.status === 401) return { ok: false, reason: "reauth-required" };
		return second;
	};
}
